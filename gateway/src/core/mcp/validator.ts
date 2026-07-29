import * as fs from 'fs';
import * as path from 'path';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate that a goal creation request has all required artifacts.
 * Checks: goals/{goalId}.md and requests/{goalId}.json exist and are non-empty.
 */
export async function validateGoalCreation(
  goalId: string,
  projectDir: string = '.'
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const goalsDir = path.join(projectDir, '.mafw/goals');
  const requestsDir = path.join(projectDir, '.mafw/requests');

  const charterPath = path.join(goalsDir, `${goalId}.md`);
  const requestPath = path.join(requestsDir, `${goalId}.json`);

  // Validate charter file
  if (!fs.existsSync(charterPath)) {
    errors.push(`Goal charter not found: ${charterPath}`);
  } else {
    const stat = fs.statSync(charterPath);
    if (stat.size === 0) {
      warnings.push(`Goal charter is empty: ${charterPath}`);
    }
  }

  // Validate request file
  if (!fs.existsSync(requestPath)) {
    errors.push(`Goal request file not found: ${requestPath}`);
  } else {
    try {
      const content = fs.readFileSync(requestPath, 'utf-8');
      const parsed = JSON.parse(content);
      if (!parsed.goalId || parsed.goalId !== goalId) {
        errors.push(`Request file goalId mismatch: expected "${goalId}", got "${parsed.goalId}"`);
      }
      if (!parsed.title) {
        warnings.push('Request file missing title');
      }
      if (!parsed.maxLoops || parsed.maxLoops < 1) {
        warnings.push('Request file maxLoops is missing or less than 1');
      }
    } catch (err: any) {
      errors.push(`Request file is invalid JSON: ${err.message}`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate that a phase has all required completion artifacts.
 * - PLANNING: waves.json must exist with at least one wave
 * - EXECUTING: receipts/{goalId}/ must contain at least one file
 * - REVIEWING: reviews/{goalId}-loop*.md must exist for current loop
 */
export async function validatePhaseCompletion(
  goalId: string,
  phase: string,
  projectDir: string = '.',
  loopNum: number = 1
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  switch (phase.toUpperCase()) {
    case 'PLANNING': {
      const wavesPath = path.join(projectDir, '.mafw/waves.json');
      if (!fs.existsSync(wavesPath)) {
        errors.push(`Waves file not found: ${wavesPath}`);
      } else {
        try {
          const content = JSON.parse(fs.readFileSync(wavesPath, 'utf-8'));
          const waves = content.waves || [];
          if (waves.length === 0) {
            errors.push('Waves file contains no waves');
          }
        } catch (err: any) {
          errors.push(`Waves file is invalid JSON: ${err.message}`);
        }
      }
      break;
    }

    case 'EXECUTING': {
      const receiptsDir = path.join(projectDir, '.mafw/receipts', goalId);
      if (!fs.existsSync(receiptsDir)) {
        errors.push(`Receipts directory not found: ${receiptsDir}`);
      } else {
        const files = fs.readdirSync(receiptsDir).filter(f => f.endsWith('.json'));
        if (files.length === 0) {
          errors.push(`No receipt files found in ${receiptsDir}`);
        }
        for (const file of files) {
          try {
            const content = JSON.parse(fs.readFileSync(path.join(receiptsDir, file), 'utf-8'));
            if (!content.taskId && !content.waveNum) {
              warnings.push(`Receipt ${file} missing taskId or waveNum`);
            }
          } catch {
            warnings.push(`Receipt ${file} is not valid JSON`);
          }
        }
      }
      break;
    }

    case 'REVIEWING': {
      const reviewsDir = path.join(projectDir, '.mafw/reviews');
      if (!fs.existsSync(reviewsDir)) {
        errors.push(`Reviews directory not found: ${reviewsDir}`);
      } else {
        const pattern = `${goalId}-loop${loopNum}.md`;
        const reviewPath = path.join(reviewsDir, pattern);
        if (!fs.existsSync(reviewPath)) {
          errors.push(`Review file not found: ${reviewPath}`);
        } else {
          const content = fs.readFileSync(reviewPath, 'utf-8');
          if (content.trim().length === 0) {
            warnings.push(`Review file is empty: ${reviewPath}`);
          }
          if (!content.includes('verdict') && !content.includes('Verdict') && !content.includes('Score') && !content.includes('score')) {
            warnings.push(`Review file may be missing verdict or score: ${reviewPath}`);
          }
        }
      }
      break;
    }

    default:
      errors.push(`Unknown phase: ${phase}. Valid phases: PLANNING, EXECUTING, REVIEWING`);
  }

  return { valid: errors.length === 0, errors, warnings };
}
