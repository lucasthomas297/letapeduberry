import {isArchivedStay} from '../assets/gestion-categories.js';
export async function archiveTrash(stay,action,env,now=new Date()){
 if(action==='restore'){
  await env.BERRY_DB.prepare('DELETE FROM archive_trash WHERE stay_id=?').bind(stay.id).run();
  return {restored:true};
 }
 if(action!=='trash')throw Error('Action inconnue.');
 if(!isArchivedStay(stay,now))throw Error('Seuls les dossiers archivés peuvent être supprimés. Annulez ou refusez d’abord une réservation active.');
 await env.BERRY_DB.prepare('INSERT OR IGNORE INTO archive_trash(stay_id,deleted_at,deleted_by) VALUES (?,?,?)').bind(stay.id,now.toISOString(),env.OWNER_EMAIL).run();
 return {trashed:true};
}
