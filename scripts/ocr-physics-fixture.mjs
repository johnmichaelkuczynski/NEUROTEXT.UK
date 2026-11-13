import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
// A small hand-drawn-style F=ma fixture, with no external assets or font packages.
const width=390,height=190;
const pixels=Buffer.alloc(width*height*3,255);
function dot(x,y) {
  for(let dx=-2;dx<=2;dx++) for(let dy=-2;dy<=2;dy++) {
    const xx=Math.round(x+dx),yy=Math.round(y+dy);
    if(xx>=0&&xx<width&&yy>=0&&yy<height&&dx*dx+dy*dy<=6) pixels.fill(20,(yy*width+xx)*3,(yy*width+xx)*3+3);
  }
}
function stroke(points) {
  for(let i=1;i<points.length;i++) {
    const [x,y]=points[i-1],[xx,yy]=points[i],steps=Math.ceil(Math.hypot(xx-x,yy-y)*2);
    for(let s=0;s<=steps;s++) dot(x+(xx-x)*s/steps,y+(yy-y)*s/steps);
  }
}
stroke([[50,135],[56,60],[106,58]]);
stroke([[54,94],[95,92]]);
stroke([[132,90],[170,88]]); stroke([[131,113],[171,112]]);
stroke([[202,135],[204,86],[205,103],[212,89],[221,86],[228,93],[230,135]]);
stroke([[230,105],[237,90],[247,87],[256,94],[260,135]]);
stroke([[318,100],[311,88],[298,87],[287,97],[283,117],[288,132],[300,135],[313,124],[319,94],[316,135],[328,135]]);
const table=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function chunk(type,data) {
  const name=Buffer.from(type),crcData=Buffer.concat([name,data]);
  let crc=0xffffffff; for(const byte of crcData) crc=table[(crc^byte)&255]^(crc>>>8);
  const len=Buffer.alloc(4),end=Buffer.alloc(4); len.writeUInt32BE(data.length);end.writeUInt32BE((crc^0xffffffff)>>>0);
  return Buffer.concat([len,name,data,end]);
}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2;
const rows=Buffer.alloc((width*3+1)*height);
for(let y=0;y<height;y++)pixels.copy(rows,y*(width*3+1)+1,y*width*3,(y+1)*width*3);
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("IDAT",deflateSync(rows)),chunk("IEND",Buffer.alloc(0))]);
const path="/tmp/neurotext-ocr-physics.png";
writeFileSync(path,png);
console.log(`Created hand-drawn-style physics OCR fixture at ${path}.`);
