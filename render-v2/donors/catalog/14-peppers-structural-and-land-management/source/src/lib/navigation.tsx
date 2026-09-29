import type { AnchorHTMLAttributes } from 'react';
type Target = {to:string;params?:Record<string,string>;search?:Record<string,string>};
export function hrefFor({to,params,search}:Target) {
  let href = to;
  for (const [key,value] of Object.entries(params || {})) href = href.replace('$'+key, encodeURIComponent(value));
  const query = new URLSearchParams(search).toString();
  return href + (query ? '?' + query : '');
}
export function navigate(target:Target) {
  window.history.pushState(null,'',hrefFor(target));
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo({top:0,behavior:'instant'});
}
export function Link({to,params,search,activeProps,onClick,...props}:Target & AnchorHTMLAttributes<HTMLAnchorElement> & {activeProps?:unknown}) {
  return <a {...props} href={hrefFor({to,params,search})} onClick={event=>{
    onClick?.(event);
    if(event.defaultPrevented || event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || props.target==='_blank') return;
    event.preventDefault(); navigate({to,params,search});
  }}/>;
}
export function useNavigate() { return navigate; }
