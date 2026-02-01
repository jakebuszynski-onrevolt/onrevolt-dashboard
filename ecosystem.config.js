module.exports = {
  apps: [{
    name: 'onrevolt',
    script: 'server.js',
	cwd: '/var/www/vhosts/onrevolt.com/httpdocs',
    env: {
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: '3000',
      NEXT_PUBLIC_BASE_PATH: '',
      NEXT_PUBLIC_TYPEFORM_FORM_ID:process.env.NEXT_PUBLIC_TYPEFORM_FORM_ID,
      NEXT_PUBLIC_TYPEFORM_BASE:process.env.NEXT_PUBLIC_TYPEFORM_BASE,
      TYPEFORM_TOKEN:process.env.TYPEFORM_TOKEN,
      PIPEDRIVE_API_TOKEN:process.env.PIPEDRIVE_API_TOKEN,
      PIPEDRIVE_DOMAIN:process.env.PIPEDRIVE_DOMAIN,
    }
  }]
};
