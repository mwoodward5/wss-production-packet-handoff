'use strict';
const {bundleFor}=require('../build/build-site.cjs');
function assertBundle(category='landscaping'){const x=bundleFor(category);if(x.manifest.renderer!=='spa-v2')throw Error('spa_renderer_mode_invalid');for(const k of ['fleet_polish','generic_mobile_polish','generic_theme_reconstruction'])if(x.manifest.flags[k]!==false)throw Error('spa_polish_bypass_missing:'+k);return {ok:true,hash:x.manifest.bundle.tree_sha256};}
module.exports={assertBundle};
