import { writeFileSync } from 'node:fs';
import { relative } from 'node:path';

// Analysis records what happened on the unmodified candidate. Only completed
// assertions qualify as a red baseline. Hooks, collection and runner failures
// are still failures of the analysis check.
export default class FixerrorsObservationReporter {
  onTestRunEnd(modules, unhandled, reason) {
    const files = modules.map(module => {
      const tests = [...module.children.allTests()];
      const failures = tests.filter(test => test.result().state === 'failed');
      const suites = [module, ...module.children.allSuites()];
      const complete = tests.some(test => ['failed', 'passed'].includes(test.result().state))
        && !tests.some(test => test.result().state === 'pending')
        && suites.every(suite => suite.errors().length === 0)
        && failures.every(test => {
          const { errors } = test.result();
          return errors?.length > 0 && errors.every(error =>
            ['AssertionError', 'TestingLibraryElementError'].includes(error.name));
        });
      return {
        path: relative(process.cwd(), module.moduleId).replaceAll('\\', '/'),
        passed: tests.filter(test => test.result().state === 'passed').length,
        failed: failures.map(test => test.fullName),
        complete,
      };
    });
    writeFileSync(process.env.SQUIRES_FIXERRORS_OBSERVATION, JSON.stringify({
      complete: reason !== 'interrupted' && unhandled.length === 0, files,
    }), { flag: 'wx' });
  }
}
