import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export default function SceneLabel({
  at,
  children,
  pixels = 28,
}: {
  at: number[];
  children: React.ReactNode;
  pixels?: number;
}) {
  const text = React.Children.toArray(children)
    .map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : ''))
    .join('');
  const sprite = useRef<THREE.Sprite>(null);
  const { texture, aspect } = useMemo(() => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    ctx.font = '20px "Segoe UI", "Microsoft YaHei",sans-serif';
    canvas.width = Math.ceil(ctx.measureText(text).width) + 24;
    canvas.height = 42;
    ctx.fillStyle = '#ffffffeb';
    ctx.fillRect(0, 0, canvas.width, 42);
    ctx.strokeStyle = '#dce6e9';
    ctx.strokeRect(1, 1, canvas.width - 2, 40);
    ctx.font = '20px "Segoe UI", "Microsoft YaHei",sans-serif';
    ctx.fillStyle = '#466572';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 12, 21);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return { texture, aspect: canvas.width / 42 };
  }, [text]);
  useEffect(() => () => texture.dispose(), [texture]);
  useFrame(({ camera, size }) => {
    if (!sprite.current) return;
    const distance = camera.position.distanceTo(new THREE.Vector3(...(at as [number, number, number])));
    const height =
      (2 *
        Math.tan(THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov / 2)) *
        distance *
        pixels) /
      size.height;
    sprite.current.scale.set(height * aspect, height, 1);
  });
  return (
    <sprite ref={sprite} position={at as any} renderOrder={20}>
      <spriteMaterial map={texture} transparent depthTest={false} depthWrite={false} toneMapped={false} />
    </sprite>
  );
}
