import {depositMethod} from './deposit-policy.mjs';
// Templates only: automatic sending remains disabled until the schedule and all texts are approved.
const dateLabel=value=>new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));
const greeting=stay=>`Bonjour ${stay.customer_first_name||stay.customer_name},`;
function requireConfirmed(stay){if(stay.status!=='confirmed')throw Error('Le séjour doit être confirmé avant de préparer ce message.');}
export function departureReminderMessage(stay){
 requireConfirmed(stay);
 return {subject:'Votre départ de L’Étape du Berry',text:`${greeting(stay)}

Nous espérons que votre séjour se passe bien.

À l’approche de votre départ, voici quelques rappels :
- Laissez les serviettes sales au sol dans la salle de bain.
- Mettez tous les déchets à la poubelle, puis déposez le sac dans les conteneurs individuels situés derrière le logement.
- Faites votre vaisselle et rangez-la.
- Merci de nous signaler si quelque chose a été abîmé ou cassé.
- Éteignez toutes les lumières.
- ${depositMethod(stay)==='cash'?'Convenez avec nous d’un rendez-vous avant votre départ pour le contrôle du logement, la remise du badge et des clés et la restitution en main propre de votre dépôt de garantie de 300 € en espèces, sous déduction des frais justifiés pour dommages.':'En cas de départ autonome, verrouillez la porte de l’appartement à clé et replacez le badge et les clés dans la boîte à clés.'}
- Maintenez les volets battants de la chambre en position ouverte, en les accrochant pour éviter qu’ils ne claquent avec le vent.
- Vous n’êtes pas obligés de fermer les volets du salon.

Votre départ est prévu le ${dateLabel(stay.departure)}, au plus tard à ${stay.late_departure?'12 h':'11 h'}.

Merci d’avance pour votre attention.
L’Étape du Berry`};
}
export function thankYouMessage(stay){
 requireConfirmed(stay);
 return {subject:'Merci pour votre séjour à L’Étape du Berry',text:`${greeting(stay)}

Merci encore pour votre séjour. Nous espérons que vous avez pleinement profité de Bourges et que l’appartement a été à la hauteur de vos attentes.

Votre retour d’expérience nous ferait plaisir et aiderait beaucoup le logement à se développer. Vous pouvez simplement répondre à cet e-mail pour nous faire part de vos impressions.

Au plaisir de vous accueillir à nouveau prochainement.
L’Étape du Berry`};
}
export function arrivalMessage(stay,env,deposit){
 if(stay.status!=='confirmed')throw Error('Le séjour doit être confirmé avant de préparer les consignes d’arrivée.');
 const cash=stay.payment_preference==='cash',arrivalTime=stay.early_arrival?'14 h':'16 h',departureTime=stay.late_departure?'12 h':'11 h';
 const cashDeposit=depositMethod(stay)==='cash';
 if(!stay.contract_accepted_at&&cashDeposit)throw Error('Le contrat doit être accepté avant l’envoi des consignes.');
 if((!cash&&!stay.paid_at)||(!cashDeposit&&deposit?.status!=='authorized'))throw Error('Les consignes d’accès autonome attendent le paiement et la validation de la garantie bancaire.');
 if(!env.ACCESS_KEYBOX_CODE||!env.ACCESS_KEYBOX_CODE.trim())throw Error('Code d’accès non configuré.');
 const welcome=cash?
  cashDeposit?'Avant 17 h 30, vous pouvez entrer de manière autonome dès l’heure prévue ci-dessus, via la boîte à clés. Un rendez-vous à partir de 17 h 30 le jour de votre arrivée est obligatoire pour régler intégralement le séjour et remettre en main propre le dépôt de garantie de 300 € en espèces, distinct du prix du séjour, contre reçus séparés. Merci de convenir avec nous de l’heure de ce rendez-vous. Aucune empreinte bancaire n’est demandée pour ce séjour.':
  'Avant 17 h 30, vous pouvez entrer de manière autonome dès l’heure prévue ci-dessus, via la boîte à clés. Un rendez-vous à partir de 17 h 30 le jour de votre arrivée est obligatoire pour régler intégralement le séjour en espèces, contre reçu. Merci de nous communiquer à l’avance votre heure d’arrivée et de convenir avec nous de l’heure du règlement. Nous pouvons également vous accueillir en personne à partir de 17 h 30.':
  'L’arrivée se fait de manière autonome via la boîte à clés. Si vous préférez être accueilli en personne, nous pouvons être présents à partir de 17 h 30. Merci de nous communiquer à l’avance votre heure d’arrivée afin que nous puissions nous organiser.';
 const access=
  `Lorsque vous êtes face à l’entrée de l’immeuble, la boîte à clés se trouve sur le rebord de la fenêtre, à droite de la porte.\nCode : ${env.ACCESS_KEYBOX_CODE.trim()}\nElle contient le badge d’accès aux parties communes et les clés de l’appartement.`;
 const text=`Bonjour ${stay.customer_first_name||stay.customer_name},

Tout est prêt pour vous accueillir.

🕓 Arrivée le ${dateLabel(stay.arrival)}, à partir de ${arrivalTime}.
${welcome}
${cashDeposit&&!cash?'Un rendez-vous à partir de 17 h 30 le jour de votre arrivée est obligatoire pour remettre en main propre le dépôt de garantie de 300 € en espèces, distinct du prix du séjour, contre reçu. Merci de convenir avec nous de l’heure de ce rendez-vous. Aucune empreinte bancaire n’est demandée pour ce séjour.':''}

🕚 Départ le ${dateLabel(stay.departure)}, au plus tard à ${departureTime}.
${cashDeposit?'Merci de convenir d’un rendez-vous avec nous avant votre départ pour le contrôle du logement, la remise des clés et la restitution en main propre du dépôt en espèces le jour du départ, sous déduction des frais justifiés pour dommages.':'Merci de nous préciser l’heure prévue afin que nous convenions ensemble des modalités. Selon votre horaire, nous pourrons également être présents.'}

📍 Accès au logement
Rez-de-chaussée, 16 Place du Général Leclerc, 18000 Bourges.
${access}
Une fois dans les parties communes, l’appartement se situe au fond à droite, au rez-de-chaussée.
Le logement est sécurisé ; l’alarme est automatiquement désactivée pendant votre séjour.

Pour le confort de tous, le logement est non-fumeur et les animaux ne sont pas autorisés. Merci de ne pas claquer la porte d’entrée des parties communes et de respecter le calme des lieux, notamment entre 21 h et 10 h.

L’appartement a été entièrement rénové : nous vous remercions d’en prendre soin.
Le ménage est inclus dans votre réservation. Vous trouverez également sur place un aspirateur et de quoi nettoyer les surfaces si besoin.

${cashDeposit?'À votre départ, remettez-nous le badge et les clés lors du rendez-vous convenu.':'À votre départ, merci de replacer le badge et les clés dans la boîte à clés si nous ne pouvons pas être présents. Nous conviendrons ensemble de cette remise avant votre départ.'}

Nous restons disponibles si vous avez la moindre question${env.OWNER_PHONE?' au '+env.OWNER_PHONE:''}.
Nous vous souhaitons une excellente arrivée à Bourges !

Bien cordialement,
L’Étape du Berry`;
 return {subject:'Votre arrivée à L’Étape du Berry',text};
}
