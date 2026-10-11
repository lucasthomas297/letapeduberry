export const BANK_DEPOSIT_MAX_NIGHTS=3;
export function stayNights(stay){const nights=(Date.parse(stay.departure)-Date.parse(stay.arrival))/86400000;if(!Number.isInteger(nights)||nights<1)throw Error('Durée de séjour invalide');return nights;}
export function depositMethod(stay){
 // A previously issued contract keeps its original guarantee terms.
 if(stay.contract_html){const match=stay.contract_html.match(/<script id="berry-document-model" type="application\/json">([\s\S]*?)<\/script>/);if(match){const model=JSON.parse(match[1]);return model.depositMethod==='cash'?'cash':'bank';}return 'bank';}
 return stayNights(stay)>BANK_DEPOSIT_MAX_NIGHTS?'cash':'bank';
}
export function depositSummary(stay){
 if(stay.contract_html){const match=stay.contract_html.match(/<script id="berry-document-model" type="application\/json">([\s\S]*?)<\/script>/);if(match){const model=JSON.parse(match[1]);if(model.depositSummary)return model.depositSummary;}return 'Dépôt de garantie bancaire de 300 €, distinct du prix du séjour, selon les modalités de votre contrat déjà établi.';}
 return depositMethod(stay)==='cash'?'Dépôt de garantie de 300 € en espèces, remis en main propre à l’arrivée contre reçu et restitué en main propre le jour du départ après contrôle du logement, sous déduction des frais justifiés pour dommages. Rendez-vous le jour de l’arrivée, à partir de 17 h 30, pour remettre le dépôt ; l’arrivée autonome et l’option d’arrivée anticipée dès 14 h restent possibles. Rendez-vous au départ pour sa restitution.':'Empreinte bancaire standard de 300 €, sans débit immédiat, demandée 48 heures avant l’arrivée ou dès la confirmation si celle-ci intervient dans ce délai. Libération demandée sous 48 heures après le départ sans dommage. La durée bancaire effective doit couvrir le séjour et le contrôle de sortie.';}

// Frozen contracts retain the authorization mode originally agreed upon.
export function bankAuthorizationMode(stay){
 if(stay.contract_html){const match=stay.contract_html.match(/<script id="berry-document-model" type="application\/json">([\s\S]*?)<\/script>/);if(match){const model=JSON.parse(match[1]);return model.bankAuthorizationMode|| (model.version==='2026-10-10-duration-deposit'?'extended':'standard');}}
 return 'standard';
}
