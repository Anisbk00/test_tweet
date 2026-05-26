'use client';

import { useState } from 'react';

interface SafeImgProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  fallback?: React.ReactNode;
}

/**
 * A safe image component that gracefully handles broken/403 images.
 * Shows a fallback placeholder when the image fails to load.
 */
export function SafeImg({ fallback, onError, ...props }: SafeImgProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className={`${props.className} flex items-center justify-center bg-secondary/50`}>
        {fallback || (
          <svg className="w-6 h-6 text-muted-foreground/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        )}
      </div>
    );
  }

  return (
    <img
      {...props}
      alt={props.alt || ''}
      onError={(e) => {
        setFailed(true);
        onError?.(e);
      }}
    />
  );
}
