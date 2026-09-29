'use strict';
function assertTruth(result){const c=result.client_data;if(!c?.identity?.businessName||!c?.identity?.city||!c?.services?.length)throw Error('spa_truth_identity_or_services_missing');if(c.trust?.aggregate&&!c.trust.aggregate.sourceUrl)throw Error('spa_truth_aggregate_unproven');for(const r of c.trust?.reviews||[])if(!r.sourceUrl)throw Error('spa_truth_review_unproven');return {ok:true,services:c.services.length,reviews:c.trust?.reviews?.length||0};}
module.exports={assertTruth};
