import { useEffect, useRef } from "react";
import * as THREE from "three";

// Ported from public/js/home.js initHero() — same particle field + floating
// torus rings, same rotation speeds. Two changes from the original: a third
// particle color (teal, the new accent) mixed in, and particle count halves
// on narrow viewports so it stays smooth on lower-end phones.
export default function Hero3D() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      75,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      1000,
    );
    camera.position.z = 5;

    const isMobile = window.innerWidth < 768;
    const count = isMobile ? 500 : 1000;

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 20;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 20;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 20;

      const roll = Math.random();
      if (roll > 0.66) {
        colors[i * 3] = 1.0; colors[i * 3 + 1] = 0.42; colors[i * 3 + 2] = 0.21; // orange
      } else if (roll > 0.33) {
        colors[i * 3] = 1.0; colors[i * 3 + 1] = 0.84; colors[i * 3 + 2] = 0.0; // gold
      } else {
        colors[i * 3] = 0.0; colors[i * 3 + 1] = 0.9; colors[i * 3 + 2] = 0.76; // teal
      }
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.06,
      transparent: true,
      opacity: 0.8,
      vertexColors: true,
    });

    const particles = new THREE.Points(geometry, material);
    scene.add(particles);

    const rings = [];
    const ringColors = [0xff6b35, 0xffd700, 0x00e6c3];
    for (let i = 0; i < 3; i++) {
      const ringGeo = new THREE.TorusGeometry(1.5 + i * 0.8, 0.02, 16, 100);
      const ringMat = new THREE.MeshBasicMaterial({
        color: ringColors[i],
        transparent: true,
        opacity: 0.12 - i * 0.02,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.random() * Math.PI;
      ring.rotation.y = Math.random() * Math.PI;
      scene.add(ring);
      rings.push(ring);
    }

    let frameId;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      particles.rotation.y += 0.0008;
      particles.rotation.x += 0.0003;
      rings.forEach((ring, i) => {
        ring.rotation.x += 0.002 * (i + 1);
        ring.rotation.y += 0.001 * (i + 1);
      });
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      camera.aspect = canvas.clientWidth / canvas.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", handleResize);
      geometry.dispose();
      material.dispose();
      rings.forEach((r) => { r.geometry.dispose(); r.material.dispose(); });
      renderer.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />;
}
