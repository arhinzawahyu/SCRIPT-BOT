module.exports = {
  apps: [{
    name: "wa-bot",
    script: "index.js",
    cwd: __dirname,
    watch: false,
    autorestart: true,
    restart_delay: 3000,
    exp_backoff_restart_delay: 1000,
    max_restarts: 50,
    max_memory_restart: "300M",
    min_uptime: "10s",
    kill_timeout: 5000,
    wait_ready: false,
    instances: 1,
    exec_mode: "fork",
    error_file: "./logs/error.log",
    out_file: "./logs/out.log",
    log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    time: true,
    env: { NODE_ENV: "production" },
    // Termux ringan: single fork, tidak watch, restart backoff hemat CPU
  }]
}
