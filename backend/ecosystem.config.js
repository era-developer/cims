module.exports = {
  apps: [{
    // Distinct from the Comedkare deployment's 'cims-backend', so both can be
    // managed by the same PM2 daemon without one replacing the other.
    name: 'kims-backend',
    script: 'server.js',
    cwd: __dirname,
    // If the process crashes outright, PM2 restarts it immediately.
    // If it keeps crashing within min_uptime, PM2 backs off instead of
    // hammering the machine in a restart loop.
    min_uptime: '10s',
    max_restarts: 10,
    // A safety net for memory leaks/bloat -- restarts if the process grows
    // past this. Doesn't by itself catch a process that's alive but stuck
    // (see the Uptime Kuma recommendation for that half of the picture).
    max_memory_restart: '600M',
    env: {
      NODE_ENV: 'production',
    },
  }],
};
