import {expect,it,vi} from "vitest";
import {exportOutpaint} from "./utils/export-outpaint";
it("exports only source pixels, scales small sources with offsets, and creates no mask",async()=>{
 const drawImage=vi.fn();
 vi.spyOn(HTMLCanvasElement.prototype,"getContext").mockReturnValue({fillStyle:"",fillRect:vi.fn(),drawImage} as unknown as CanvasRenderingContext2D);
 vi.spyOn(HTMLCanvasElement.prototype,"toBlob").mockImplementation(cb=>cb(new Blob(["png"])));
 const source=document.createElement("canvas");
 const result=await exportOutpaint({source,width:256,height:512,strokes:[]},{width:384,height:512,imageX:0,imageY:0});
 expect(result.width).toBe(512);expect(result.height).toBe(1024);expect(result.extension.right).toBe(256);
 expect(drawImage).toHaveBeenCalledWith(source,0,0,512,1024);expect(result).not.toHaveProperty("mask");
 vi.restoreAllMocks();
});
