// Execute this complete file through Affinity's execute_script MCP tool.
const {Document,NewDocumentOptions,UnitType,FileExportOptions,FileExportArea}=require('/document.js');
const {ContainerNodeDefinition,PolyCurveNodeDefinition}=require('/nodes.js');
const {AddChildNodesCommandBuilder}=require('/commands.js');
const {CurveBuilder,PolyCurve}=require('/geometry.js');
const {Colour}=require('/colours.js');
const {FillDescriptor}=require('/fills.js');
const {LineStyle,LineStyleDescriptor,LineType}=require('/linestyle.js');
const {File}=require('/fs.js');
const {Application}=require('/application.js');

const U=76;
const revision=2;
const M=(x,y)=>['M',x,y], L=(x,y)=>['L',x,y];
const arc=(cx,cy,r,a,b)=>['A',cx,cy,r,a,b];
const polygon=pts=>[M(...pts[0]),...pts.slice(1).map(p=>L(...p)),['Z']];
const circle=(x,y,r)=>[M(x+r,y),arc(x,y,r,0,Math.PI),arc(x,y,r,Math.PI,2*Math.PI),['Z']];
const rect=(x,y,w,h)=>polygon([[x,y],[x+w,y],[x+w,y+h],[x,y+h]]);
const guide=(tier,path)=>({tier,path});
const line=(tier,x1,y1,x2,y2)=>guide(tier,[M(x1,y1),L(x2,y2)]);

// Seed: raw logit scores, conventionally z; two score rails joined before normalisation.
const horizontalTrim=revision===2?1/8:0; // Lighter horizontal rails match the diagonal's apparent weight.
const railHeight=2-horizontalTrim;
const side=4*Math.SQRT2;
const p=polygon([[-side/2,-4],[side/2,-4],[side/2,-4+railHeight],[-side/2+2,4-railHeight],[side/2,4-railHeight],[side/2,4],[-side/2,4],[-side/2,4-railHeight],[side/2-2,-4+railHeight],[-side/2,-4+railHeight]]);
const guides=[];
for(const v of [-4,-2,0,2,4])guides.push(line(v===0?'secondary':'auxiliary',-side/2-1.2,v,side/2+1.2,v));
for(const v of [-side/2,0,side/2])guides.push(line(v===0?'secondary':'primary',v,-5.2,v,5.2));
const nominalSlope=2/(side/2-1);
guides.push(line('primary',-5/nominalSlope,5,5/nominalSlope,-5));
guides.push(line('secondary',-side*5/8,-5,side*5/8,5));
guides.push(line('primary',-5/nominalSlope-1,5,5/nominalSlope-1,-5));
guides.push(line('primary',-5/nominalSlope+1,5,5/nominalSlope+1,-5));
guides.push(line('auxiliary',-side/2+2,-5,-side/2+2,5),line('auxiliary',side/2-2,-5,side/2-2,5));
const anchors=[[-side/2,-4],[side/2,-4],[side/2,-2],[-side/2+2,2],[side/2,4],[-side/2,4],[-side/2,2],[side/2-2,-2]];
const spec={name:'Scorefold',slug:'03-scorefold',seed:'Logit (confirmed name origin)',system:'1:sqrt(2) rectangle; height 8U, width 4sqrt(2)U; nominal horizontal rails 2U',path:p,guides,anchors,bounds:[-side/2,-4,side,8],tight:[-side/2,-4,side,8],corrections:['Horizontal rails reduced from 2U to 15U/8 to balance the diagonal.','The diagonal is a connecting score fold, not a plot of sigmoid or softmax; no mathematical curve is claimed.','Rail spacing follows the module; only the outer rectangle follows the irrational ratio.']};


const out=Application.userDesktopPath+'/logitland-logo/astra/'+spec.slug;
// Affinity cannot overwrite a native file while its previous document is open.
for(const previous of Document.all){if(previous.path===out+'/'+spec.slug+'.af')previous.close();}
const options=NewDocumentOptions.createDefault();
options.units=UnitType.Pixel;options.dpi=96;options.viewDpi=96;
options.width=2560;options.height=1440;options.isTransparentBackground=false;
const doc=Document.create(options),spread=doc.currentSpread;
function add(def,parent){
  const builder=AddChildNodesCommandBuilder.create();builder.setInsertionTarget(parent);builder.addNode(def);
  const command=builder.createCommand();doc.executeCommand(command);return command.newNodes[0];
}
const layer=(name,parent=spread)=>add(ContainerNodeDefinition.create(name),parent);
const colour=(hex,alpha=255)=>{const v=parseInt(hex.slice(1),16);return FillDescriptor.createSolid(Colour.createRGBA8({r:v>>16,g:(v>>8)&255,b:v&255,alpha}));};
const none=FillDescriptor.createNone();
function nativePath(path,scale=U,dx=1280,dy=720){
  const builder=CurveBuilder.create();
  for(const c of path){
    if(c[0]==='M')builder.beginXY(dx+c[1]*scale,dy+c[2]*scale);
    if(c[0]==='L')builder.lineToXY(dx+c[1]*scale,dy+c[2]*scale);
    if(c[0]==='Z')builder.close();
    if(c[0]==='A'){
      const [,cx,cy,r,start,end]=c,n=Math.ceil(Math.abs(end-start)/(Math.PI/2));
      for(let i=0;i<n;i++){
        const a=start+(end-start)*i/n,b=start+(end-start)*(i+1)/n,k=4/3*Math.tan((b-a)/4);
        builder.addBezierXY(dx+scale*(cx+r*(Math.cos(a)-k*Math.sin(a))),dy+scale*(cy+r*(Math.sin(a)+k*Math.cos(a))),dx+scale*(cx+r*(Math.cos(b)+k*Math.sin(b))),dy+scale*(cy+r*(Math.sin(b)-k*Math.cos(b))),dx+scale*(cx+r*Math.cos(b)),dy+scale*(cy+r*Math.sin(b)));
      }
    }
  }
  const poly=PolyCurve.create();poly.addCurve(builder.createCurve());return poly;
}
function node(path,parent,{fill='#111111',alpha=255,stroke=null,width=0,dash=false,scale=U,dx=1280,dy=720,name='Curve'}={}){
  const ls=LineStyle.createDefaultWithWeight(width||1);
  if(dash){ls.type=LineType.Dash;ls.dashPattern=[8/width,6/width];}
  const def=PolyCurveNodeDefinition.create(nativePath(path,scale,dx,dy),fill?colour(fill,alpha):none,stroke?colour(stroke):none,LineStyleDescriptor.create(ls),none);
  def.userDescription=name;return add(def,parent);
}
const paper=layer('Paper');node(rect(0,0,2560,1440),paper,{fill:'#FAFAFA',scale:1,dx:0,dy:0,name:'FAFAFA'});
doc.selection=[paper];doc.setEditable(false);
const guidesLayer=layer('Guides');
const tierStyles={auxiliary:{stroke:'#999999',width:1.3},secondary:{stroke:'#666666',width:1.7,dash:true},primary:{stroke:'#333333',width:2.4}};
for(const tier of ['auxiliary','secondary','primary']){
  const group=layer(tier,guidesLayer);
  for(const g of spec.guides.filter(g=>g.tier===tier))node(g.path,group,{fill:null,...tierStyles[tier],name:tier+' construction'});
}
doc.selection=[guidesLayer];doc.setEditable(false);
const markLayer=layer('Mark');
const mark=node(spec.path,markLayer,{name:spec.name});
doc.selection=[mark];
const svgOptions=FileExportOptions.createWithPresetName('SVG (for export)');
const pngOptions=FileExportOptions.createWithPresetName('PNG');
const inkResult=doc.export(out+'/mark-affinity.svg',svgOptions,FileExportArea.createForSelection(doc.selection));
console.log('Mark export '+JSON.stringify(inkResult.all.map(r=>({ok:r.isSuccess,error:r.errorMessage}))));
// The editable mark adopts the board treatment after the one-ink export.
mark.brushFillDescriptor=colour('#000000',26);
mark.penFillDescriptor=colour('#222222');mark.lineStyleDescriptor=LineStyleDescriptor.createDefault(2.6);
const anchorsLayer=layer('Anchors');
for(const a of spec.anchors)node(circle(a[0],a[1],.055),anchorsLayer,{fill:'#FAFAFA',stroke:'#333333',width:1.7,name:'Construction anchor'});
const [x,y,w,h]=spec.bounds;
for(const [bx,by] of [[x,y],[x+w,y],[x,y+h],[x+w,y+h]])node(rect(bx-.045,by-.045,.09,.09),anchorsLayer,{fill:'#FAFAFA',stroke:'#999999',width:1.3,name:'Bounds'});
node([M(-.12,0),L(.12,0)],anchorsLayer,{fill:null,stroke:'#666666',width:1.7,name:'Centre'});
node([M(0,-.12),L(0,.12)],anchorsLayer,{fill:null,stroke:'#666666',width:1.7,name:'Centre'});
doc.selection=[anchorsLayer];doc.setEditable(false);doc.selection=[];
doc.saveAs(out+'/'+spec.slug+'.af');
const results=doc.export(out+'/board-affinity.png',pngOptions,FileExportArea.createForWholeDocument());
console.log('Board export '+JSON.stringify(results.all.map(r=>({ok:r.isSuccess,error:r.errorMessage}))));

// Exact circular SVG companion: same primitives as the editable Affinity curves.
const num=n=>Math.round(n*1e6)/1e6;
function data(path,scale=1,dx=0,dy=0){return path.map(c=>{
 if(c[0]==='M'||c[0]==='L')return c[0]+num(dx+c[1]*scale)+' '+num(dy+c[2]*scale);
 if(c[0]==='Z')return 'Z';
 const [,cx,cy,r,a,b]=c;
 return 'A'+num(r*scale)+' '+num(r*scale)+' 0 '+(Math.abs(b-a)>Math.PI?1:0)+' '+(b>a?1:0)+' '+num(dx+scale*(cx+r*Math.cos(b)))+' '+num(dy+scale*(cy+r*Math.sin(b)));
}).join(' ');}
function write(name,text){const f=File.create(out+'/'+name,'w');f.writeString(text);f.close();}
const vb=spec.tight.map(num).join(' ');
write('mark.svg','<svg xmlns="http://www.w3.org/2000/svg" viewBox="'+vb+'"><path fill="#111" d="'+data(spec.path)+'"/></svg>\n');
write('pink.svg','<svg xmlns="http://www.w3.org/2000/svg" viewBox="'+vb+'"><path fill="#ff55ff" d="'+data(spec.path)+'"/></svg>\n');
const pinkScale=352/spec.tight[3];
const pinkX=256-(spec.tight[0]+spec.tight[2]/2)*pinkScale;
const pinkY=256-(spec.tight[1]+spec.tight[3]/2)*pinkScale;
write('pink-on-dark.svg','<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><path fill="#181416" d="M0 0H512V512H0Z"/><path fill="#ff55ff" d="'+data(spec.path,pinkScale,pinkX,pinkY)+'"/></svg>\n');
const pinkDoc=Document.load(out+'/pink-on-dark.svg');
const pinkResult=pinkDoc.export(out+'/pink-on-dark.png',pngOptions,FileExportArea.createForWholeDocument());
console.log('Pink export '+JSON.stringify(pinkResult.all.map(r=>({ok:r.isSuccess,error:r.errorMessage}))));
pinkDoc.close();
let board='<svg xmlns="http://www.w3.org/2000/svg" width="2560" height="1440" viewBox="0 0 2560 1440"><path fill="#FAFAFA" d="M0 0H2560V1440H0Z"/>';
for(const tier of ['auxiliary','secondary','primary']){
 const s=tierStyles[tier];board+='<g id="'+tier+'" fill="none" stroke="'+s.stroke+'" stroke-width="'+s.width+'"'+(s.dash?' stroke-dasharray="8 6"':'')+'>';
 for(const g of spec.guides.filter(g=>g.tier===tier))board+='<path d="'+data(g.path,U,1280,720)+'"/>';
 board+='</g>';
}
board+='<g id="mark"><path fill="black" fill-opacity="0.10" stroke="#222" stroke-width="2.6" d="'+data(spec.path,U,1280,720)+'"/></g><g id="anchors" fill="#FAFAFA" stroke="#333" stroke-width="1.7">';
for(const a of spec.anchors)board+='<circle cx="'+num(1280+a[0]*U)+'" cy="'+num(720+a[1]*U)+'" r="4.18"/>';
for(const [bx,by] of [[x,y],[x+w,y],[x,y+h],[x+w,y+h]])board+='<path stroke="#999" stroke-width="1.3" d="'+data(rect(bx-.045,by-.045,.09,.09),U,1280,720)+'"/>';
board+='<path fill="none" stroke="#666" d="M1271 720H1289M1280 711V729"/></g></svg>\n';
write('board.svg',board);
write('construction.json',JSON.stringify({name:spec.name,seed:spec.seed,system:spec.system,U,revision,corrections:spec.corrections,guideElements:spec.guides.length+spec.anchors.length+6,documentSession:doc.sessionUuid},null,2));
console.log(JSON.stringify({name:spec.name,session:doc.sessionUuid,guideCount:spec.guides.length+spec.anchors.length+6,saved:doc.path}));
