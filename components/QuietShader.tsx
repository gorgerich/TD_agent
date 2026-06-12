"use client";

// Тихий WebGL-слой (DELIGHT: shader-слой). Закон DESIGN.md: только две
// поверхности - обложка login и hero-сумма /co. Не операционные экраны.
//
// Без зависимостей: один fullscreen-треугольник + fragment shader.
// «Шёлк» - медленное слоистое волновое поле в палитре бренда; поверх -
// затухающие кольцевые ripple от указателя или программного pulse().
//
// Деградация: prefers-reduced-motion → один статичный кадр без цикла;
// нет WebGL → канвас остаётся прозрачным, под ним CSS-фолбэк родителя;
// вкладка скрыта/элемент вне вьюпорта → цикл останавливается.

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

export type QuietShaderHandle = {
  /** Программный всплеск: координаты 0..1 (по умолчанию центр). */
  pulse: (x?: number, y?: number, strength?: number) => void;
};

type Palette = "night" | "accent";

// Палитры из токенов globals.css (захардкожены: WebGL не читает CSS-переменные,
// а цвета бренда стабильны - см. DESIGN.md «Токены»).
const PALETTES: Record<Palette, { base: [number, number, number]; glow: [number, number, number]; amp: number }> = {
  night: { base: [0x00 / 255, 0x1f / 255, 0x27 / 255], glow: [0x0b / 255, 0x4f / 255, 0x49 / 255], amp: 0.85 },
  accent: { base: [0x00 / 255, 0x3a / 255, 0x35 / 255], glow: [0x07 / 255, 0x59 / 255, 0x50 / 255], amp: 0.55 },
};

const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform vec3 u_base;
uniform vec3 u_glow;
uniform float u_amp;
uniform vec4 u_ripple[4]; // xy: пиксели, z: время старта, w: сила (0 = слот пуст)

float field(vec2 p, float t) {
  float n = 0.0;
  n += sin(p.x * 2.6 + t * 1.7 + sin(p.y * 2.1 - t * 1.3) * 1.35);
  n += sin((p.x + p.y) * 1.9 - t * 0.9 + sin(p.x * 4.3 + t * 0.7) * 0.7) * 0.75;
  n += sin(length(p - vec2(1.15, 0.35)) * 4.2 - t * 1.9) * 0.45;
  return n / 2.2;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = uv * vec2(u_res.x / u_res.y, 1.0);
  float t = u_time * 0.06;

  float n = field(p, t) * 0.5 + 0.5;

  float r = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 rp = u_ripple[i];
    if (rp.w > 0.0) {
      float age = u_time - rp.z;
      float d = distance(gl_FragCoord.xy, rp.xy);
      float front = d - age * 260.0;
      r += exp(-abs(front) * 0.016) * exp(-age * 1.7) * rp.w * sin(front * 0.05);
    }
  }

  float v = smoothstep(0.18, 1.0, n) * u_amp + r * 0.4;
  vec3 col = mix(u_base, u_glow, clamp(v, 0.0, 1.0));

  // Мягкая виньетка к краям - поле «дышит» в центре, тихое по периметру.
  float vig = smoothstep(1.35, 0.42, distance(uv, vec2(0.42, 0.5)));
  col = mix(u_base, col, vig);

  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export const QuietShader = forwardRef<QuietShaderHandle, {
  palette: Palette;
  className?: string;
  /** Ripple от движения указателя (login-обложка). */
  interactive?: boolean;
}>(function QuietShader({ palette, className, interactive = false }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Слоты ripple: [x, y, t0, strength] x4; пишем по кругу.
  const ripples = useRef(new Float32Array(16));
  const slot = useRef(0);
  const clock = useRef({ start: 0, now: 0 });

  const addRipple = (px: number, py: number, strength: number) => {
    const i = slot.current * 4;
    ripples.current[i] = px;
    ripples.current[i + 1] = py;
    ripples.current[i + 2] = clock.current.now;
    ripples.current[i + 3] = strength;
    slot.current = (slot.current + 1) % 4;
  };

  useImperativeHandle(ref, () => ({
    pulse(x = 0.5, y = 0.5, strength = 1) {
      const c = canvasRef.current;
      if (!c) return;
      addRipple(x * c.width, (1 - y) * c.height, strength);
    },
  }), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
    });
    if (!gl) return; // нет WebGL - прозрачный канвас, CSS-фолбэк родителя

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;
    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const u = {
      res: gl.getUniformLocation(prog, "u_res"),
      time: gl.getUniformLocation(prog, "u_time"),
      base: gl.getUniformLocation(prog, "u_base"),
      glow: gl.getUniformLocation(prog, "u_glow"),
      amp: gl.getUniformLocation(prog, "u_amp"),
      ripple: gl.getUniformLocation(prog, "u_ripple"),
    };
    const pal = PALETTES[palette];
    gl.uniform3fv(u.base, pal.base);
    gl.uniform3fv(u.glow, pal.glow);
    gl.uniform1f(u.amp, pal.amp);

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const resize = () => {
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
        gl.uniform2f(u.res, w, h);
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    clock.current.start = performance.now();
    let raf = 0;
    let visible = true;
    let lost = false;

    const draw = () => {
      clock.current.now = (performance.now() - clock.current.start) / 1000;
      gl.uniform1f(u.time, clock.current.now);
      gl.uniform4fv(u.ripple, ripples.current);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const loop = () => {
      if (!visible || lost) return;
      draw();
      raf = requestAnimationFrame(loop);
    };

    if (reduced) {
      // Один статичный кадр на «красивом» моменте поля - живости нет, материал есть.
      clock.current.start = performance.now() - 7000;
      draw();
    } else {
      raf = requestAnimationFrame(loop);
    }

    // Вне вьюпорта (hero /co проскроллен) - цикл стоит, GPU спит.
    const io = new IntersectionObserver(([entry]) => {
      const was = visible;
      visible = entry.isIntersecting;
      if (!reduced && visible && !was) raf = requestAnimationFrame(loop);
      if (!visible) cancelAnimationFrame(raf);
    });
    io.observe(canvas);

    const onLost = (e: Event) => {
      e.preventDefault();
      lost = true;
      cancelAnimationFrame(raf);
    };
    canvas.addEventListener("webglcontextlost", onLost);

    let lastMove = 0;
    const onMove = (e: PointerEvent) => {
      if (reduced) return;
      const now = performance.now();
      if (now - lastMove < 180) return; // дозируем: тихие редкие круги, не шлейф
      lastMove = now;
      const r = canvas.getBoundingClientRect();
      addRipple((e.clientX - r.left) * dpr, (r.height - (e.clientY - r.top)) * dpr, 0.35);
    };
    const onDown = (e: PointerEvent) => {
      if (reduced) return;
      const r = canvas.getBoundingClientRect();
      addRipple((e.clientX - r.left) * dpr, (r.height - (e.clientY - r.top)) * dpr, 1);
    };
    // Зона жестов: ближайший [data-shader-host] (контент-«соседи» канваса не
    // дают событиям дойти до родителя), иначе - прямой родитель.
    const host = canvas.closest<HTMLElement>("[data-shader-host]") ?? canvas.parentElement;
    if (interactive && host) {
      host.addEventListener("pointermove", onMove);
      host.addEventListener("pointerdown", onDown);
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      canvas.removeEventListener("webglcontextlost", onLost);
      if (interactive && host) {
        host.removeEventListener("pointermove", onMove);
        host.removeEventListener("pointerdown", onDown);
      }
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buf);
    };
  }, [palette, interactive]);

  return <canvas ref={canvasRef} className={className} aria-hidden />;
});
