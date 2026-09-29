/* WSS dashboard enhancement layer. Loaded only on customer dashboard routes.
   The base dashboard remains the authority for auth, edits and confirmation. */
(function(){
  'use strict';
  var $=function(id){return document.getElementById(id);};
  var micPreflight=false,micBusy=false,previewInitialized=false;

  function setMic(words,tone){var el=$('micstatus');if(!el)return;el.textContent=words||'';if(tone)el.setAttribute('data-wss-tone',tone);else el.removeAttribute('data-wss-tone');}
  async function micPermission(){if(!navigator.permissions||typeof navigator.permissions.query!=='function')return 'unknown';try{return (await navigator.permissions.query({name:'microphone'})).state||'unknown';}catch(_){return 'unknown';}}
  async function preflightMic(button){
    if(micBusy)return false;
    if(!window.isSecureContext){setMic('Microphone needs a secure HTTPS page.','bad');return false;}
    if(!navigator.mediaDevices||typeof navigator.mediaDevices.getUserMedia!=='function'){setMic('This browser is not exposing a microphone device to the dashboard.','bad');return false;}
    var Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!Recognition){setMic('Voice typing is not supported by this browser. Chrome or Edge desktop is recommended.','warn');return false;}
    micBusy=true;button.setAttribute('data-wss-checking','1');
    try{
      var state=await micPermission();
      if(state==='denied'){setMic('Microphone is blocked for wss-ai.com. Use the address-bar site controls to allow Microphone, then tap again.','bad');return false;}
      setMic(state==='prompt'?'Allow microphone access when your browser asks.':'Checking your microphone…','warn');
      var stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
      var tracks=stream.getTracks(),live=tracks.some(function(t){return t.readyState==='live';});tracks.forEach(function(t){try{t.stop();}catch(_){}});
      if(!live){setMic('A microphone was found but did not become active. Check Windows input settings.','bad');return false;}
      micPreflight=true;setMic('Microphone ready — listening starts now.','ok');return true;
    }catch(err){
      var name=String(err&&err.name||'');
      if(name==='NotAllowedError'||name==='SecurityError')setMic('Microphone permission is blocked. Allow it for wss-ai.com in the address bar, then tap again.','bad');
      else if(name==='NotFoundError'||name==='DevicesNotFoundError')setMic('No microphone device is available. Check the Windows input device and reconnect your headset or mic.','bad');
      else if(name==='NotReadableError'||name==='TrackStartError')setMic('The microphone is busy in another app. Close the app using it, then tap again.','bad');
      else setMic('Could not start the microphone: '+(err&&err.message?err.message:name||'unknown browser error')+'.','bad');
      return false;
    }finally{micBusy=false;button.removeAttribute('data-wss-checking');}
  }
  function wireMic(){
    var button=$('chatmic');if(!button||button.getAttribute('data-wss-wired')==='1')return;button.setAttribute('data-wss-wired','1');button.hidden=false;
    button.addEventListener('click',function(event){if(button.getAttribute('data-wss-pass')==='1'){button.removeAttribute('data-wss-pass');return;}if(micPreflight)return;event.preventDefault();event.stopImmediatePropagation();preflightMic(button).then(function(ok){if(!ok)return;button.setAttribute('data-wss-pass','1');button.click();});},true);
    if(navigator.mediaDevices&&typeof navigator.mediaDevices.addEventListener==='function')navigator.mediaDevices.addEventListener('devicechange',function(){micPreflight=false;setMic('Microphone device changed. Tap the microphone to reconnect.','warn');});
  }

  function ensureRibbon(){var preview=$('editor-preview');if(!preview)return null;var node=$('wss-editor-ribbon');if(node)return node;node=document.createElement('div');node.id='wss-editor-ribbon';node.innerHTML='<i></i><span>Live preview connected</span>';preview.appendChild(node);return node;}
  function paintRibbon(){var ribbon=ensureRibbon(),status=$('previewstatus'),theater=$('edittheater');if(!ribbon)return;var text=status&&status.textContent?status.textContent.trim():'Live preview',open=theater&&!theater.hidden;ribbon.className=open?'on busy':'on';var span=ribbon.querySelector('span');if(span)span.textContent=open?'Riley is applying your edit — the preview will reveal it when live':text;clearTimeout(paintRibbon._t);paintRibbon._t=setTimeout(function(){if(!open)ribbon.className='';},2600);}

  function setDevice(device){
    var canvas=$('previewcanvas');if(!canvas)return;
    canvas.classList.toggle('phone',device==='phone');canvas.classList.toggle('tablet',device==='tablet');
    ['previewdesktop','previewtablet','previewphone'].forEach(function(id){var b=$(id);if(b)b.setAttribute('aria-pressed',id==='preview'+device?'true':'false');});
  }
  function wireDeviceButtons(){
    [['previewdesktop','desktop'],['previewphone','phone']].forEach(function(pair){
      var button=$(pair[0]);if(!button||button.getAttribute('data-wss-device-wire')==='1')return;
      button.setAttribute('data-wss-device-wire','1');button.addEventListener('click',function(){setDevice(pair[1]);});
    });
  }
  function ensureTablet(){
    var existing=$('previewtablet');
    if(existing){wireDeviceButtons();return;}
    var phone=$('previewphone');if(!phone||!phone.parentNode)return;
    var b=document.createElement('button');b.className='preview-tool';b.id='previewtablet';b.type='button';b.title='Tablet preview';b.setAttribute('aria-pressed','false');b.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M11 18h2"/></svg><span>Tablet</span>';
    phone.parentNode.insertBefore(b,phone);b.addEventListener('click',function(){setDevice('tablet');});wireDeviceButtons();
  }
  function chooseMobileDefault(){if(previewInitialized)return;var phone=$('previewphone');if(!phone)return;previewInitialized=true;phone.click();setDevice('phone');}

  var uploadGroups=[
    {key:'photos',icon:'▧',title:'Photos',sub:'JPG · PNG · WebP · GIF',accept:'image/png,image/jpeg,image/gif,image/webp'},
    {key:'brand',icon:'◇',title:'Logo / brand',sub:'PNG · JPG · SVG',accept:'image/png,image/jpeg,image/webp,image/svg+xml,.svg'},
    {key:'docs',icon:'▤',title:'Documents',sub:'PDF · DOCX · TXT · MD · HTML',accept:'application/pdf,.pdf,.docx,.txt,.md,.html,.htm'},
    {key:'media',icon:'▶',title:'Media',sub:'Video · audio',accept:'video/mp4,video/quicktime,video/webm,audio/mpeg,audio/wav,audio/mp4,audio/ogg,.mp4,.mov,.webm,.mp3,.wav,.m4a,.ogg'}
  ];
  function openPicker(accept){var input=$('chatfiles');if(!input)return;input.setAttribute('accept',accept);input.click();}
  function ensureUploadDeck(){
    if($('wss-upload-deck'))return;
    var row=$('chatattachlabel');if(!row||!row.parentNode)return;
    var deck=document.createElement('div');deck.id='wss-upload-deck';deck.setAttribute('aria-label','Attach files for Riley');
    deck.innerHTML=uploadGroups.map(function(g){return '<button type="button" class="wss-upload-tile" data-wss-accept="'+g.accept+'"><b>'+g.icon+' <span>'+g.title+'</span></b><small>'+g.sub+'</small></button>';}).join('');
    row.parentNode.parentNode.insertBefore(deck,row.parentNode);
    deck.querySelectorAll('[data-wss-accept]').forEach(function(b){b.addEventListener('click',function(){openPicker(b.getAttribute('data-wss-accept'));});});
    deck.addEventListener('dragover',function(e){e.preventDefault();deck.classList.add('drag');});deck.addEventListener('dragleave',function(){deck.classList.remove('drag');});
    deck.addEventListener('drop',function(e){e.preventDefault();deck.classList.remove('drag');var input=$('chatfiles');if(!input||!e.dataTransfer||!e.dataTransfer.files.length)return;try{var dt=new DataTransfer();Array.from(e.dataTransfer.files).forEach(function(f){dt.items.add(f);});input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));}catch(_){setMic('Use one of the upload boxes to choose those files.','warn');}});
    row.textContent='Add files';row.setAttribute('aria-label','Add files');
  }

  function wirePreview(){
    var preview=$('editor-preview');if(!preview)return;
    if(preview.getAttribute('data-wss-enhanced')!=='1'){
      preview.setAttribute('data-wss-enhanced','1');ensureRibbon();ensureTablet();wireDeviceButtons();chooseMobileDefault();ensureUploadDeck();
      var status=$('previewstatus'),theater=$('edittheater'),canvas=$('previewcanvas'),frame=$('sitepreview'),observer=new MutationObserver(paintRibbon);
      if(status)observer.observe(status,{subtree:true,childList:true,attributes:true,characterData:true});if(theater)observer.observe(theater,{attributes:true,attributeFilter:['hidden','class']});
      if(frame)frame.addEventListener('load',function(){if(canvas){canvas.classList.remove('reveal');void canvas.offsetWidth;canvas.classList.add('loaded','reveal');}paintRibbon();});
      var chips=$('chatchips');if(chips)new MutationObserver(function(){var box=document.querySelector('.command-box');if(box){box.classList.add('wss-upload-flash');setTimeout(function(){box.classList.remove('wss-upload-flash');},650);}}).observe(chips,{childList:true});
    }else{ensureTablet();wireDeviceButtons();chooseMobileDefault();ensureUploadDeck();}
  }
  function boot(){wireMic();wirePreview();document.documentElement.classList.add('wss-dashboard-enhanced');}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  new MutationObserver(function(){wireMic();wirePreview();}).observe(document.documentElement,{childList:true,subtree:true});
})();