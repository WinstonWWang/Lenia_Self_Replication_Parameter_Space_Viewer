import { useEffect, useRef, useState } from "react";

import type { VideoAsset } from "../data";

export interface VideoPanelProps {
  asset?: VideoAsset | null;
  src?: string | null;
  posterSrc?: string | null;
  posterAlt?: string;
  selectionKey: string;
  placeholderTitle?: string;
  placeholderMessage?: string;
}

function StaticReport({
  src,
  alt,
}: {
  src: string;
  alt: string;
}) {
  return (
    <figure className="video-panel__static-report">
      <img src={src} alt={alt} />
      <figcaption>Static search report — video unavailable.</figcaption>
    </figure>
  );
}

function PlayableVideo({
  asset,
  src,
  posterSrc,
  posterAlt,
}: {
  asset: VideoAsset;
  src: string;
  posterSrc?: string | null;
  posterAlt: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Strict Mode intentionally runs setup/cleanup twice in development.
    // Restore the source here because cleanup detaches it to stop downloads.
    video.src = src;
    video.currentTime = 0;
    video.load();
    void video.play().catch(() => {
      // Muted autoplay normally succeeds; native controls remain available if
      // a browser or device policy requires an explicit play gesture.
    });

    return () => {
      video.pause();
      video.currentTime = 0;
      video.removeAttribute("src");
      video.load();
    };
  }, [src]);

  if (failed) {
    if (posterSrc) {
      return <StaticReport src={posterSrc} alt={posterAlt} />;
    }
    return (
      <div className="video-panel__placeholder" role="alert">
        <strong>Video unavailable</strong>
        <span>The published replay could not be loaded.</span>
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      className="video-panel__video"
      src={src}
      poster={posterSrc ?? undefined}
      width={asset.width}
      height={asset.height}
      autoPlay
      muted
      loop
      controls
      playsInline
      preload="metadata"
      onError={() => setFailed(true)}
      aria-label="Lenia dynamics replay"
    >
      This browser cannot play the published dynamics replay.
    </video>
  );
}

export function VideoPanel({
  asset,
  src,
  posterSrc,
  posterAlt = "Static search report",
  selectionKey,
  placeholderTitle = "No video",
  placeholderMessage = "A dynamics replay is unavailable for this point.",
}: VideoPanelProps) {
  return (
    <section className="video-panel" aria-labelledby="video-panel-heading">
      <div className="video-panel__heading-row">
        <h3 id="video-panel-heading">Dynamics replay</h3>
        {asset && src ? (
          <span>Muted · looping · controls below</span>
        ) : posterSrc ? (
          <span>Static report · no video</span>
        ) : null}
      </div>
      <div
        className="video-panel__frame"
        style={
          asset && src
            ? { aspectRatio: `${asset.width} / ${asset.height}` }
            : undefined
        }
      >
        {asset && src ? (
          <PlayableVideo
            key={`${selectionKey}:${asset.key}`}
            asset={asset}
            src={src}
            posterSrc={posterSrc}
            posterAlt={posterAlt}
          />
        ) : posterSrc ? (
          <StaticReport src={posterSrc} alt={posterAlt} />
        ) : (
          <div className="video-panel__placeholder" role="status">
            <strong>{placeholderTitle}</strong>
            <span>{placeholderMessage}</span>
          </div>
        )}
      </div>
    </section>
  );
}
