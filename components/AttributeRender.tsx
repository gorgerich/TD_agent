import { getItem, type AttrSelection } from "@/lib/attributes";

/*
  Собираемый векторный рендер сцены прощания: гроб (цвет дерева + фурнитура),
  покрывало, крест, венки. Обновляется от выбранной атрибутики.
  Чистый компонент без состояния — используется и у агента, и у клиента.
  Поле image в каталоге зарезервировано под реальные фото на будущее.
*/

function Cross({ color = "#7a5230", style = "wood" }: { color?: string; style?: string }) {
  const metal = style === "metal";
  const stroke = metal ? "#6f747e" : "#00000022";
  return (
    <g transform="translate(96 92)">
      <ellipse cx="14" cy="214" rx="34" ry="9" fill="#00000010" />
      {/* стойка */}
      <rect x="6" y="0" width="18" height="210" rx="3" fill={color} stroke={stroke} strokeWidth="0.8" />
      {/* верхняя малая перекладина (для православного) */}
      {style === "carved" && <rect x="-4" y="26" width="38" height="11" rx="2.5" fill={color} stroke={stroke} strokeWidth="0.8" />}
      {/* основная перекладина */}
      <rect x="-22" y="52" width="74" height="18" rx="3" fill={color} stroke={stroke} strokeWidth="0.8" />
      {/* нижняя косая перекладина (для православного) */}
      {style === "carved" && (
        <rect x="-2" y="120" width="34" height="10" rx="2.5" fill={color} stroke={stroke} strokeWidth="0.8" transform="rotate(-18 15 125)" />
      )}
      {metal && <rect x="9" y="3" width="4" height="204" rx="2" fill="#ffffff55" />}
    </g>
  );
}

function Wreath({ x, y, color = "#3f5d3a", accent = "#efece4", scale = 1 }: { x: number; y: number; color?: string; accent?: string; scale?: number }) {
  const r = 44 * scale;
  const flowers = Array.from({ length: 12 });
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx="0" cy={r + 10} rx={r * 0.9} ry="8" fill="#00000010" />
      {/* зелёное кольцо */}
      <circle cx="0" cy="0" r={r} fill="none" stroke={color} strokeWidth={13 * scale} />
      <circle cx="0" cy="0" r={r} fill="none" stroke="#00000018" strokeWidth={13 * scale} strokeDasharray="3 6" />
      {/* цветы */}
      {flowers.map((_, i) => {
        const a = (i / flowers.length) * Math.PI * 2;
        return <circle key={i} cx={Math.cos(a) * r} cy={Math.sin(a) * r} r={4.2 * scale} fill={accent} stroke="#00000012" strokeWidth="0.5" />;
      })}
      {/* лента */}
      <path d={`M ${-8 * scale} ${r - 2} L ${-14 * scale} ${r + 30 * scale} L ${-2 * scale} ${r + 22 * scale} L ${8 * scale} ${r + 30 * scale} L ${4 * scale} ${r - 2} Z`} fill={accent} opacity="0.85" stroke="#00000010" strokeWidth="0.6" />
    </g>
  );
}

export default function AttributeRender({ selection, className }: { selection: AttrSelection; className?: string }) {
  const coffin = getItem(selection.coffin);
  const fittings = getItem(selection.fittings);
  const textile = getItem(selection.textile);
  const cross = getItem(selection.cross);
  const wreaths = (selection.wreaths ?? []).map(getItem).filter(Boolean).slice(0, 3);

  const wood = coffin?.render.color ?? "#c8a06a";
  const grain = coffin?.render.grain ?? "#a87f4a";
  const metal = fittings?.render.metal ?? "#b9bcc2";
  const cloth = textile?.render.color;

  // верх/низ гроба (вид сверху, голова слева)
  const cy = 232;
  const coffinPath = `M 168 ${cy - 30} L 232 ${cy - 56} L 470 ${cy - 26} L 470 ${cy + 26} L 232 ${cy + 56} L 168 ${cy + 30} Z`;
  const lidPath = `M 182 ${cy - 22} L 234 ${cy - 44} L 458 ${cy - 19} L 458 ${cy + 19} L 234 ${cy + 44} L 182 ${cy + 22} Z`;

  const handleY = [cy - 44, cy - 8, cy + 28];

  return (
    <svg viewBox="0 0 600 400" className={className} role="img" aria-label="Рендер оформления прощания" preserveAspectRatio="xMidYMid meet">
      <defs>
        <clipPath id="coffinClip"><path d={coffinPath} /></clipPath>
        <linearGradient id="woodSheen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.18" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.12" />
        </linearGradient>
      </defs>

      {/* фон-площадка */}
      <rect x="0" y="0" width="600" height="400" fill="transparent" />
      <ellipse cx="320" cy="320" rx="250" ry="36" fill="#00000008" />

      {cross && <Cross color={cross.render.color} style={cross.render.style} />}

      {/* тень гроба */}
      <ellipse cx="320" cy={cy + 70} rx="170" ry="20" fill="#00000012" />

      {/* корпус гроба */}
      <path d={coffinPath} fill={wood} stroke="#00000022" strokeWidth="1.2" />
      {/* текстура дерева */}
      <g clipPath="url(#coffinClip)" opacity="0.5">
        {Array.from({ length: 7 }).map((_, i) => (
          <path key={i} d={`M 168 ${cy - 30 + i * 9} Q 320 ${cy - 34 + i * 9} 470 ${cy - 26 + i * 9}`} fill="none" stroke={grain} strokeWidth="1.2" />
        ))}
      </g>
      <path d={coffinPath} fill="url(#woodSheen)" />
      {/* крышка-вставка */}
      <path d={lidPath} fill="none" stroke="#ffffff44" strokeWidth="1.4" />
      <path d={lidPath} fill="none" stroke="#00000018" strokeWidth="0.8" transform="translate(0 1.5)" />

      {/* покрывало */}
      {cloth && (
        <g clipPath="url(#coffinClip)">
          <path d={`M 210 ${cy - 16} L 360 ${cy - 22} L 360 ${cy + 22} L 210 ${cy + 16} Z`} fill={cloth} opacity="0.92" />
          {[0, 1, 2, 3].map((i) => (
            <path key={i} d={`M ${230 + i * 34} ${cy - 20} L ${236 + i * 34} ${cy + 20}`} stroke="#00000018" strokeWidth="1" />
          ))}
          <path d={`M 210 ${cy - 16} L 360 ${cy - 22}`} stroke="#ffffff55" strokeWidth="1.2" />
        </g>
      )}

      {/* фурнитура — ручки по бокам */}
      {fittings &&
        handleY.flatMap((hy, i) => [
          <g key={`t${i}`} transform={`translate(${250 + i * 70} ${cy - 50 - i * 1})`}>
            <rect x="-13" y="-4" width="26" height="7" rx="3.5" fill={metal} stroke="#00000022" strokeWidth="0.6" />
            <rect x="-13" y="-4" width="26" height="2.4" rx="1.2" fill="#ffffff66" />
          </g>,
          <g key={`b${i}`} transform={`translate(${250 + i * 70} ${cy + 50 + i * 1})`}>
            <rect x="-13" y="-3" width="26" height="7" rx="3.5" fill={metal} stroke="#00000022" strokeWidth="0.6" />
            <rect x="-13" y="-3" width="26" height="2.4" rx="1.2" fill="#ffffff66" />
          </g>,
        ])}
      {/* уголки */}
      {fittings &&
        [[176, cy - 26], [462, cy - 22], [462, cy + 22], [176, cy + 26]].map(([hx, hyy], i) => (
          <circle key={i} cx={hx} cy={hyy} r="4.5" fill={metal} stroke="#00000022" strokeWidth="0.6" />
        ))}

      {/* венки */}
      {wreaths[0] && <Wreath x={118} y={300} color={wreaths[0]!.render.color} accent={wreaths[0]!.render.accent} scale={0.95} />}
      {wreaths[1] && <Wreath x={500} y={296} color={wreaths[1]!.render.color} accent={wreaths[1]!.render.accent} scale={1.05} />}
      {wreaths[2] && <Wreath x={300} y={344} color={wreaths[2]!.render.color} accent={wreaths[2]!.render.accent} scale={0.8} />}
    </svg>
  );
}
