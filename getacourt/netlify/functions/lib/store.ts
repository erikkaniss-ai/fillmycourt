import { getDeployStore, getStore } from '@netlify/blobs';

export function bookingStore(){
  const production = Netlify.context?.deploy?.context === 'production';
  return production ? getStore('getacourt-bookings',{consistency:'strong'}) : getDeployStore('getacourt-bookings');
}

export function id(prefix:string){
  return `${prefix}-${crypto.randomUUID().replaceAll('-','').slice(0,10).toUpperCase()}`;
}
