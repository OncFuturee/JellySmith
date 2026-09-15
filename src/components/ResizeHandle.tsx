import { useRef, type KeyboardEvent, type PointerEvent } from "react";

type Props={axis:"x"|"y";value:number;min:number;max:number;className:string;label:string;onChange:(value:number)=>void;onCommit:(value:number)=>void;invert?:boolean};
const clamp=(value:number,min:number,max:number)=>Math.min(max,Math.max(min,value));

export default function ResizeHandle({axis,value,min,max,className,label,onChange,onCommit,invert=false}:Props){
  const latest=useRef(value);
  const start=(event:PointerEvent<HTMLDivElement>)=>{
    event.currentTarget.setPointerCapture(event.pointerId);
    const origin=axis==="x"?event.clientX:event.clientY; const initial=value;
    const move=(next:globalThis.PointerEvent)=>{const point=axis==="x"?next.clientX:next.clientY;latest.current=clamp(initial+(point-origin)*(invert?-1:1),min,max);onChange(latest.current);};
    const end=()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",end);onCommit(latest.current);};
    window.addEventListener("pointermove",move);window.addEventListener("pointerup",end,{once:true});
  };
  const key=(event:KeyboardEvent<HTMLDivElement>)=>{const direction=axis==="x"?(event.key==="ArrowRight"?1:event.key==="ArrowLeft"?-1:0):(event.key==="ArrowDown"?1:event.key==="ArrowUp"?-1:0);if(!direction)return;event.preventDefault();const next=clamp(value+direction*10*(invert?-1:1),min,max);onChange(next);onCommit(next);};
  return <div className={`resize-handle ${className}`} role="separator" aria-label={label} aria-orientation={axis==="x"?"vertical":"horizontal"} aria-valuemin={min} aria-valuemax={max} aria-valuenow={Math.round(value)} tabIndex={0} onPointerDown={start} onKeyDown={key}/>;
}
