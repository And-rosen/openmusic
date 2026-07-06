import { memo } from 'react';

interface Props {
  coverUrl: string;
  loaded: boolean;
}

function TvCoverBackground({ coverUrl, loaded }: Props) {
  return (
    <>
      <div
        className="absolute inset-0 bg-cover bg-center scale-110 contain-strict"
        style={{
          backgroundImage: loaded ? `url(${coverUrl})` : undefined,
          filter: 'blur(36px) brightness(0.35)',
          willChange: loaded ? 'auto' : 'opacity',
        }}
      />
      <img
        src={coverUrl}
        alt=""
        className="hidden"
        loading="eager"
        decoding="async"
        fetchPriority="high"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/20 to-black/70" />
    </>
  );
}

export default memo(TvCoverBackground);
