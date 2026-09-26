import { calibrateThreshold } from '../src/server/calibration';

async function main() {
  const args = process.argv.slice(2);
  let vaultPath = process.env.VAULT_PATH || '';
  let sampleSize = 80;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--vault' && args[i + 1]) {
      vaultPath = args[i + 1];
      i++;
    } else if (args[i] === '--sample' && args[i + 1]) {
      sampleSize = parseInt(args[i + 1], 10);
      i++;
    }
  }

  if (!vaultPath) {
    console.error('Usage: npm run calibrate -- --vault <path_to_vault> [--sample 80]');
    process.exit(1);
  }

  console.log(`[Calibration Engine] Running threshold calibration for vault: ${vaultPath}`);
  console.log(`[Calibration Engine] Sample size target: ${sampleSize}`);

  try {
    const result = await calibrateThreshold({
      vaultPath,
      sampleSize
    });

    if (result.calibrated) {
      console.log('\n================ CALIBRATION SUCCESS ================');
      console.log(`Optimal Tau Threshold: ${result.tau}`);
      console.log(`Accuracy at Tau:       ${Math.round((result.accuracyAtTau || 0) * 100)}%`);
      console.log(`Coverage at Tau:       ${Math.round((result.coverageAtTau || 0) * 100)}%`);
      console.log(`Sample Size:           ${result.sampleSize} notes`);
      console.log(`Timestamp:             ${result.calibratedAt}`);
      console.log('Saved to:              99_System/index/thresholds.json');
      console.log('=====================================================\n');
    } else {
      console.log('\n================ CALIBRATION FAILED ================');
      console.log(`Reason: ${result.reason}`);
      if (result.topErrors && result.topErrors.length > 0) {
        console.log('Top Misclassifications:');
        result.topErrors.forEach(err => {
          console.log(` - ${err.filename}: actual "${err.actual}" vs predicted "${err.predicted}" (conf: ${err.confidence})`);
        });
      }
      console.log('====================================================\n');
      process.exit(1);
    }
  } catch (err: any) {
    console.error(`Calibration error: ${err.message}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
