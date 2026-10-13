export async function bookingSettings(env){
 const row=await env.BERRY_DB.prepare('SELECT min_nights FROM booking_settings WHERE id=1').first();
 const value=row?.min_nights;
 if(!Number.isInteger(value)||value<1||value>60)throw Error('Réglage de séjour invalide');
 return {min_nights:value};
}
export async function saveBookingSettings(env,data){
 if(!Number.isInteger(data?.min_nights)||data.min_nights<1||data.min_nights>60)throw Error('Choisissez un nombre entier entre 1 et 60 nuits.');
 await env.BERRY_DB.prepare('UPDATE booking_settings SET min_nights=?,updated_at=?,updated_by=? WHERE id=1').bind(data.min_nights,new Date().toISOString(),env.OWNER_EMAIL).run();
 return bookingSettings(env);
}
