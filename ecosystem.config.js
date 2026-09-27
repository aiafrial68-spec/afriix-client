module.exports = {
  apps: [{
    name: 'afriix',
    script: './index.js',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_restarts: 20,
    min_uptime: '10s',
    restart_delay: 5000,
    kill_timeout: 5000,
    max_memory_restart: '512M',
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    env: { NODE_ENV: 'production' }
  }]
};
