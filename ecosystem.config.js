module.exports = {
  apps: [{
    name: "wa-bot",
    script: "index.js",
    watch: false,
    autorestart: true,
    restart_delay: 3000,
    max_restarts: 100,
    exp_backoff_restart_delay: 100,
    error_file: "./logs/error.log",
    out_file: "./logs/out.log",
    time: true,
  }]
}
