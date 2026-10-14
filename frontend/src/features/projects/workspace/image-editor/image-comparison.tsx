import { ChevronsLeftRight } from "lucide-react";
import { useState } from "react";

export function ImageComparison({ original, result }: { original: string; result: string }) {
  const [position, setPosition] = useState(50);
  return <div className="inpaint-comparison">
    <img src={result} alt="重绘结果" />
    <img className="inpaint-original" src={original} alt="重绘前原图" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }} />
    <span className="comparison-label before">原图</span><span className="comparison-label after">重绘结果</span>
    <div className="comparison-divider" style={{ left: `${position}%` }}><span><ChevronsLeftRight size={17} strokeWidth={1.8} /></span></div>
    <input type="range" min={0} max={100} value={position} aria-label="左右拖动对比原图和重绘结果" onChange={event => setPosition(Number(event.target.value))} />
  </div>;
}
