const fs=require('fs');
const SRC='C:/Users/BNKlaptop/.openclaw/media/inbound/';
const OUT='D:/openclaw/Projects/coreader/tour/rooms/';
fs.mkdirSync(OUT,{recursive:true});
const map={
 // excluded per user: first/tunnel image = cheraq-noor (tunnel regen)
 'Underground_Persian_bath_interior_2K_20261004140646':'hammam.jpg',
 'Persian_study_writing_room_2K_20261004142900':'study.jpg',
 'Underground_Persian_tavern_interior_2K_20261004151020':'mikhane.jpg',
 'Underground_Persian_mud_brick_li_2K_20261004151711':'library.jpg',
 'Underground_Persian_picture_gall_2K_20261004152812':'gallery.jpg'
};
let n=0;
for(const f of fs.readdirSync(SRC)){
 if(!/\.jpg$/i.test(f))continue;
 const key=f.split('---')[0];
 if(map[key]){fs.copyFileSync(SRC+f,OUT+map[key]);n++;console.log('copied',map[key]);}
}
console.log('total',n);
