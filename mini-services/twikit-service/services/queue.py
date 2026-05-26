"""Simple background task queue for syncing bookmarks and other data."""

import asyncio
import logging
import time
import threading
from typing import Optional, Callable, Any
from dataclasses import dataclass, field
from enum import Enum

from config import settings

logger = logging.getLogger(__name__)


class TaskStatus(str, Enum):
    """Status of a background task."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    RETRYING = "retrying"


@dataclass
class Task:
    """A background task with tracking information."""

    id: str
    task_type: str
    user_id: str
    status: TaskStatus = TaskStatus.PENDING
    progress: float = 0.0
    result: Any = None
    error: Optional[str] = None
    retries: int = 0
    max_retries: int = 3
    created_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    completed_at: Optional[float] = None
    metadata: dict = field(default_factory=dict)


class BackgroundQueue:
    """Simple in-process background task queue with retry logic."""

    def __init__(self):
        self._tasks: dict[str, Task] = {}
        self._lock = threading.RLock()
        self._running = False
        self._worker_thread: Optional[threading.Thread] = None
        self._task_counter = 0

    def start(self) -> None:
        """Start the background worker thread."""
        if self._running:
            return
        self._running = True
        self._worker_thread = threading.Thread(
            target=self._worker_loop, daemon=True
        )
        self._worker_thread.start()
        logger.info("Background queue worker started")

    def stop(self) -> None:
        """Stop the background worker thread."""
        self._running = False
        if self._worker_thread:
            self._worker_thread.join(timeout=5)
        logger.info("Background queue worker stopped")

    def enqueue(
        self,
        task_type: str,
        user_id: str,
        coro_factory: Callable,
        max_retries: int = None,
        metadata: dict = None,
    ) -> str:
        """Add a task to the queue. Returns the task ID."""
        with self._lock:
            self._task_counter += 1
            task_id = f"task_{self._task_counter}_{int(time.time())}"

            task = Task(
                id=task_id,
                task_type=task_type,
                user_id=user_id,
                max_retries=max_retries or settings.SYNC_MAX_RETRIES,
                metadata=metadata or {},
            )
            task._coro_factory = coro_factory
            self._tasks[task_id] = task

            logger.info(
                f"Enqueued task {task_id} of type {task_type} for user {user_id}"
            )
            return task_id

    def get_task(self, task_id: str) -> Optional[Task]:
        """Get a task by ID."""
        with self._lock:
            return self._tasks.get(task_id)

    def get_user_tasks(self, user_id: str) -> list[Task]:
        """Get all tasks for a user."""
        with self._lock:
            return [
                t for t in self._tasks.values() if t.user_id == user_id
            ]

    def get_sync_status(self, user_id: str) -> dict:
        """Get the sync status for a user."""
        with self._lock:
            user_tasks = [
                t
                for t in self._tasks.values()
                if t.user_id == user_id and t.task_type == "sync_bookmarks"
            ]

            if not user_tasks:
                return {
                    "is_syncing": False,
                    "last_sync_at": None,
                    "sync_count": 0,
                    "error_count": 0,
                    "last_error": None,
                    "current_task_id": None,
                }

            # Get the most recent sync task
            latest = max(user_tasks, key=lambda t: t.created_at)
            completed_tasks = [
                t for t in user_tasks if t.status == TaskStatus.COMPLETED
            ]
            failed_tasks = [
                t for t in user_tasks if t.status == TaskStatus.FAILED
            ]

            last_sync_at = None
            if completed_tasks:
                last_sync_at = max(
                    t.completed_at for t in completed_tasks
                )

            last_error = None
            if failed_tasks:
                last_failed = max(
                    failed_tasks, key=lambda t: t.completed_at or 0
                )
                last_error = last_failed.error

            return {
                "is_syncing": latest.status
                in (TaskStatus.RUNNING, TaskStatus.PENDING, TaskStatus.RETRYING),
                "last_sync_at": last_sync_at,
                "sync_count": len(completed_tasks),
                "error_count": len(failed_tasks),
                "last_error": last_error,
                "current_task_id": latest.id if latest.status in (
                    TaskStatus.RUNNING,
                    TaskStatus.PENDING,
                    TaskStatus.RETRYING,
                ) else None,
            }

    def _worker_loop(self) -> None:
        """Main worker loop that processes tasks."""
        while self._running:
            task = self._get_next_task()
            if task is None:
                time.sleep(1)
                continue

            self._execute_task(task)

    def _get_next_task(self) -> Optional[Task]:
        """Get the next pending task."""
        with self._lock:
            pending = [
                t
                for t in self._tasks.values()
                if t.status in (TaskStatus.PENDING, TaskStatus.RETRYING)
            ]
            if not pending:
                return None
            # Sort by creation time (FIFO)
            pending.sort(key=lambda t: t.created_at)
            return pending[0]

    def _execute_task(self, task: Task) -> None:
        """Execute a single task with retry logic."""
        with self._lock:
            task.status = TaskStatus.RUNNING
            task.started_at = time.time()

        logger.info(f"Executing task {task.id} of type {task.task_type}")

        try:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                result = loop.run_until_complete(task._coro_factory())
            finally:
                loop.close()

            with self._lock:
                task.status = TaskStatus.COMPLETED
                task.result = result
                task.completed_at = time.time()
                task.progress = 1.0

            logger.info(f"Task {task.id} completed successfully")

        except Exception as e:
            logger.error(f"Task {task.id} failed: {e}")

            with self._lock:
                task.retries += 1
                task.error = str(e)

                if task.retries < task.max_retries:
                    task.status = TaskStatus.RETRYING
                    logger.info(
                        f"Task {task.id} will retry "
                        f"({task.retries}/{task.max_retries})"
                    )
                else:
                    task.status = TaskStatus.FAILED
                    task.completed_at = time.time()
                    logger.error(
                        f"Task {task.id} failed permanently after "
                        f"{task.max_retries} retries"
                    )

    def cleanup_old_tasks(self, max_age_seconds: int = 3600) -> int:
        """Remove completed/failed tasks older than max_age_seconds."""
        with self._lock:
            now = time.time()
            to_remove = [
                tid
                for tid, task in self._tasks.items()
                if task.status
                in (TaskStatus.COMPLETED, TaskStatus.FAILED)
                and task.completed_at
                and (now - task.completed_at) > max_age_seconds
            ]
            for tid in to_remove:
                del self._tasks[tid]
            return len(to_remove)


# Singleton queue instance
queue = BackgroundQueue()


def get_queue() -> BackgroundQueue:
    """Get the global BackgroundQueue instance."""
    return queue
