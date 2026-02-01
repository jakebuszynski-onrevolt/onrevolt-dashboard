module.exports = {
  apps: [
    {
      name: 'onrevolt-dev',
      cwd: '/var/www/vhosts/onrevolt.com/httpdocs',
      script: 'yarn',
      args: 'dev',
      env: { NODE_ENV: 'development', PORT: 3004 },
      watch: false, // HMR ogarnia zmiany, PM2 nie musi “watch”
    }
  ]
}
