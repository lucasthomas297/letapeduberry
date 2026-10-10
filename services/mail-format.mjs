export function mailDate(value,{time=false}={}) {
 if(!value)return 'non renseignée';
 const date=new Date(time?value:value+'T12:00:00Z');
 if(!Number.isFinite(date.getTime()))return 'date à vérifier';
 const day=new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'long',year:'numeric',timeZone:'Europe/Paris'}).format(date);
 if(!time)return day;
 const hour=new Intl.DateTimeFormat('fr-FR',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Paris'}).format(date).replace(':',' h ');
 return `${day} à ${hour} (heure de Paris)`;
}
export function guestMailText(text) {
 return text.replaceAll(' La durée bancaire effective doit couvrir le séjour et le contrôle de sortie.','')
  .replaceAll('sous déduction des frais justifiés pour dommages.','si aucune dégradation n’est constatée.');
}
