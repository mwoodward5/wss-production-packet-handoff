"use strict";

/**
 * A GPU-backed ambient layer for the owner Command Center.
 *
 * This is deliberately native WebGL rather than a remote Three.js bundle:
 * the emergency stop, launch controls, and batch rows must still render when a
 * CDN is unavailable. The canvas is pointer-transparent, pauses when hidden,
 * respects reduced motion, and falls back to static CSS when WebGL is absent.
 */
const consoleOrbitHtml = String.raw`
<style>
  #wss-command-orbit{
    position:fixed;inset:0;z-index:0;pointer-events:none;opacity:.78;
    mix-blend-mode:screen;
    -webkit-mask-image:linear-gradient(to bottom,rgba(0,0,0,.96),rgba(0,0,0,.3) 72%,transparent);
    mask-image:linear-gradient(to bottom,rgba(0,0,0,.96),rgba(0,0,0,.3) 72%,transparent)
  }
  #wss-command-orbit[data-fallback="1"]{
    background:
      radial-gradient(circle at 72% 14%,rgba(124,108,246,.17),transparent 33%),
      radial-gradient(circle at 18% 42%,rgba(52,211,153,.09),transparent 29%)
  }
  body>.wrap,body>.access{position:relative;z-index:1}
  @media (prefers-reduced-motion:reduce){#wss-command-orbit{opacity:.42}}
</style>
<canvas id="wss-command-orbit" aria-hidden="true"></canvas>
<script>
(function(){
  var canvas=document.getElementById("wss-command-orbit");
  if(!canvas)return;
  var gl=canvas.getContext("webgl",{alpha:true,antialias:false,preserveDrawingBuffer:false});
  if(!gl){canvas.setAttribute("data-fallback","1");return;}
  var reduce=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var vertex=[
    "attribute float seed;",
    "uniform float time;uniform float activity;uniform float aspect;",
    "varying float glow;",
    "void main(){",
    "float ring=fract(seed*.6180339);",
    "float arm=6.2831853*(ring+time*(.012+.026*activity));",
    "float radius=.16+.82*fract(seed*.381966);",
    "float depth=.38+.62*fract(seed*.754877);",
    "vec2 q=vec2(cos(arm),sin(arm))*radius;",
    "q.x/=max(aspect,1.0);",
    "q.y+=sin(time*.21+seed*51.0)*.045*(1.0-activity*.35);",
    "gl_Position=vec4(q,0.,1.);",
    "gl_PointSize=(1.4+4.8*depth)*(1.0+activity*.35);",
    "glow=depth;",
    "}"
  ].join("");
  var fragment=[
    "precision mediump float;uniform float activity;varying float glow;",
    "void main(){",
    "vec2 d=gl_PointCoord-.5;float a=smoothstep(.5,.06,length(d));",
    "vec3 violet=vec3(.38,.32,1.);vec3 mint=vec3(.20,.83,.60);",
    "vec3 c=mix(violet,mint,glow*.7+activity*.2);",
    "gl_FragColor=vec4(c,a*(.18+.48*glow));",
    "}"
  ].join("");
  function compile(type,source){
    var shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);
    return gl.getShaderParameter(shader,gl.COMPILE_STATUS)?shader:null;
  }
  var vs=compile(gl.VERTEX_SHADER,vertex),fs=compile(gl.FRAGMENT_SHADER,fragment);
  if(!vs||!fs){canvas.setAttribute("data-fallback","1");return;}
  var program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS)){canvas.setAttribute("data-fallback","1");return;}

  var count=260,data=new Float32Array(count);
  for(var i=0;i<count;i++)data[i]=i/count;
  var buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);
  var seedLoc=gl.getAttribLocation(program,"seed");
  var timeLoc=gl.getUniformLocation(program,"time");
  var activityLoc=gl.getUniformLocation(program,"activity");
  var aspectLoc=gl.getUniformLocation(program,"aspect");
  var dpr=1,width=0,height=0,start=performance.now(),activity=0,running=false;

  function resize(){
    dpr=Math.min(window.devicePixelRatio||1,1.5);
    width=Math.max(1,window.innerWidth);height=Math.max(1,window.innerHeight);
    canvas.width=Math.floor(width*dpr);canvas.height=Math.floor(height*dpr);
    canvas.style.width=width+"px";canvas.style.height=height+"px";
    gl.viewport(0,0,canvas.width,canvas.height);
  }
  function number(selector){var el=document.querySelector(selector);return Number(el&&el.textContent)||0;}
  function draw(now){
    var moving=number(".ph-stat.building b"),ready=number(".ph-stat.ready b"),failed=number(".ph-stat.refused b");
    var target=Math.min(1,(moving*1.5+ready*.25+failed*.5)/10);
    activity+=(target-activity)*.035;
    gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE);
    gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.enableVertexAttribArray(seedLoc);gl.vertexAttribPointer(seedLoc,1,gl.FLOAT,false,0,0);
    gl.uniform1f(timeLoc,reduce?0:(now-start)/1000);
    gl.uniform1f(activityLoc,activity);
    gl.uniform1f(aspectLoc,Math.max(1,width/height));
    gl.drawArrays(gl.POINTS,0,count);
  }
  function frame(now){
    if(!running)return;
    if(!document.hidden)draw(now);
    if(!reduce)requestAnimationFrame(frame);else running=false;
  }
  function startLoop(){if(running)return;running=true;requestAnimationFrame(frame);}
  window.addEventListener("resize",function(){resize();draw(performance.now());},{passive:true});
  document.addEventListener("visibilitychange",function(){if(!document.hidden)startLoop();});
  resize();startLoop();
})();
</script>`;

module.exports = { consoleOrbitHtml };
