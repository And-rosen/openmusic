import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { RoomVisualFxSettings, RoomVisualPresetId } from '../../lib/roomVisualPreset';
import { toProxiedMediaUrl } from '../../lib/mediaProxyUrl';
import { makeDotTexture } from './lib/dotTexture';
import { readGalaxyAudioBands, resumeGalaxyAudioContext } from './lib/galaxyAudio';
import { buildGalaxyParticleGeometry } from './lib/particleGeometry';
import {
  PARTICLE_BLOOM_FRAGMENT_SHADER,
  PARTICLE_BLOOM_VERTEX_SHADER,
  PARTICLE_FRAGMENT_SHADER,
} from './lib/shaders';
import { PARTICLE_VERTEX_SHADER } from './lib/visualVertexShader';

const DEFAULT_COVER = '#1c1c28';

function makePlaceholderTexture(color = DEFAULT_COVER): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 4;
  const x = c.getContext('2d');
  if (x) {
    x.fillStyle = color;
    x.fillRect(0, 0, 4, 4);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

interface Props {
  coverUrl?: string | null;
  preset: RoomVisualPresetId;
  fx: RoomVisualFxSettings;
  isPlaying: boolean;
}

export default function GalaxyParticles({ coverUrl, preset, fx, isPlaying }: Props) {
  const geometry = useMemo(() => buildGalaxyParticleGeometry(), []);
  const bloomGeometry = useMemo(() => geometry.clone(), [geometry]);
  const dotTex = useMemo(() => makeDotTexture(), []);
  const edgeTex = useMemo(() => makePlaceholderTexture('#800000'), []);
  const rippleTex = useMemo(() => makePlaceholderTexture('#000000'), []);
  const coverTex = useRef<THREE.Texture>(makePlaceholderTexture());
  const prevCoverTex = useRef<THREE.Texture>(makePlaceholderTexture());
  const colorMixRef = useRef(1);
  const presetRef = useRef(preset);
  const burstRef = useRef(0);

  const uniforms = useRef({
    uTime: { value: 0 },
    uBass: { value: 0 },
    uMid: { value: 0 },
    uTreble: { value: 0 },
    uBeat: { value: 0 },
    uEnergy: { value: 0 },
    uBurstAmt: { value: 0 },
    uPreset: { value: preset },
    uIntensity: { value: fx.intensity },
    uDepth: { value: fx.depth },
    uPointScale: { value: fx.point },
    uSpeed: { value: fx.speed },
    uTwist: { value: 0 },
    uVinylSpin: { value: 0 },
    uColorBoost: { value: fx.colorBoost },
    uScatter: { value: 0.008 },
    uCoverRes: { value: 1.0 },
    uBgFade: { value: 0.2 },
    uBloomStrength: { value: fx.bloomStrength },
    uBloomSize: { value: 2.65 },
    uHasCover: { value: 0 },
    uHasDepth: { value: 0 },
    uEdgeEnabled: { value: 0 },
    uAiBoost: { value: 0 },
    uMouseActive: { value: 0 },
    uMouseXY: { value: new THREE.Vector2(-999, -999) },
    uHandXY: { value: new THREE.Vector2(-999, -999) },
    uHandActive: { value: 0 },
    uGestureGrip: { value: 0 },
    uTintColor: { value: new THREE.Color('#9db8cf') },
    uTintStrength: { value: 0 },
    uPixel: { value: Math.min(window.devicePixelRatio || 1, 1.75) },
    uColorMixT: { value: 1 },
    uLoading: { value: 0 },
    uCoverTex: { value: coverTex.current },
    uPrevCoverTex: { value: prevCoverTex.current },
    uEdgeTex: { value: edgeTex },
    uRippleTex: { value: rippleTex },
    uRippleCount: { value: 0 },
    uDotTex: { value: dotTex },
    uAlpha: { value: 1 },
    uParticleDim: { value: 1 },
  }).current;

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: PARTICLE_VERTEX_SHADER,
        fragmentShader: PARTICLE_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
      }),
    [uniforms],
  );

  const bloomMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: PARTICLE_BLOOM_VERTEX_SHADER,
        fragmentShader: PARTICLE_BLOOM_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    [uniforms],
  );

  useEffect(() => {
    if (presetRef.current !== preset) {
      presetRef.current = preset;
      burstRef.current = 0.35;
      uniforms.uColorMixT.value = 1;
      colorMixRef.current = 1;
    }
    uniforms.uPreset.value = preset;
  }, [preset, uniforms]);

  useEffect(() => {
    uniforms.uIntensity.value = fx.intensity;
    uniforms.uDepth.value = fx.depth;
    uniforms.uPointScale.value = fx.point;
    uniforms.uSpeed.value = fx.speed;
    uniforms.uColorBoost.value = fx.colorBoost;
    uniforms.uBloomStrength.value = fx.bloomStrength;
  }, [fx, uniforms]);

  useEffect(() => {
    const prev = coverTex.current;
    prevCoverTex.current = prev;
    uniforms.uColorMixT.value = 0;
    colorMixRef.current = 0;

    if (!coverUrl) {
      const placeholder = makePlaceholderTexture();
      coverTex.current = placeholder;
      uniforms.uCoverTex.value = placeholder;
      uniforms.uHasCover.value = 0;
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const tex = new THREE.Texture(img);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.needsUpdate = true;
      coverTex.current = tex;
      uniforms.uCoverTex.value = tex;
      uniforms.uHasCover.value = 1;
    };
    img.onerror = () => {
      const placeholder = makePlaceholderTexture();
      coverTex.current = placeholder;
      uniforms.uCoverTex.value = placeholder;
      uniforms.uHasCover.value = 0;
    };
    img.src = toProxiedMediaUrl(coverUrl);

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [coverUrl, uniforms]);

  useFrame((state, delta) => {
    resumeGalaxyAudioContext();
    const bands = readGalaxyAudioBands();
    uniforms.uTime.value = state.clock.elapsedTime;
    uniforms.uBass.value = bands.bass;
    uniforms.uMid.value = bands.mid;
    uniforms.uTreble.value = bands.treble;
    uniforms.uBeat.value = bands.beat;
    uniforms.uEnergy.value = bands.energy;
    uniforms.uPixel.value = state.gl.getPixelRatio();
    uniforms.uVinylSpin.value = isPlaying ? state.clock.elapsedTime * fx.speed * 0.42 : state.clock.elapsedTime * 0.05;

    burstRef.current *= 1 - delta * 2.5;
    uniforms.uBurstAmt.value = burstRef.current;

    colorMixRef.current = Math.min(1, colorMixRef.current + delta / 0.55);
    uniforms.uColorMixT.value = colorMixRef.current;
  });

  useEffect(
    () => () => {
      geometry.dispose();
      bloomGeometry.dispose();
      material.dispose();
      bloomMaterial.dispose();
      dotTex.dispose();
      edgeTex.dispose();
      rippleTex.dispose();
      coverTex.current.dispose();
      prevCoverTex.current.dispose();
    },
    [bloomGeometry, bloomMaterial, dotTex, edgeTex, geometry, material, rippleTex],
  );

  return (
    <>
      <points geometry={bloomGeometry} material={bloomMaterial} frustumCulled={false} renderOrder={0} />
      <points geometry={geometry} material={material} frustumCulled={false} renderOrder={1} />
    </>
  );
}
