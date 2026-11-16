export default {
  testDir: 'D:/传智杯1/counterlab/policyglass/frontend/tests',
  testMatch: 'inspection.spec.ts', workers: 1, timeout: 90000,
  expect: { timeout: 20000 },
  outputDir: 'D:/传智杯1/counterlab/policyglass/.runtime/two-chat-76425c0/round3-fresh-test-results',
  use: {
    baseURL: 'http://localhost:5173', viewport: { width:1440,height:1100 },
    headless: true, channel: 'chromium', trace:'retain-on-failure', screenshot:'only-on-failure',
    launchOptions:{args:['--disable-crash-reporter','--disable-breakpad','--enable-unsafe-swiftshader']},
  },
};
