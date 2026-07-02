import { GitUtils } from '../../../src/utils/git';

const mockGit = {
  checkoutBranch: jest.fn().mockResolvedValue(undefined),
  checkout: jest.fn().mockResolvedValue(undefined),
  merge: jest.fn().mockResolvedValue(undefined),
  branchLocal: jest.fn().mockResolvedValue({ all: ['main', 'feature'] }),
  add: jest.fn().mockResolvedValue(undefined),
  commit: jest.fn().mockResolvedValue(undefined),
  stash: jest.fn().mockResolvedValue(undefined)
};

jest.mock('simple-git', () => ({
  __esModule: true,
  default: jest.fn(() => mockGit)
}));

let git: GitUtils;

beforeEach(() => {
  git = new GitUtils('/project');
});

afterEach(() => {
  jest.clearAllMocks();
});

test('createBranch checks out from base', async () => {
  await git.createBranch('feature', 'main');
  expect(mockGit.checkoutBranch).toHaveBeenCalledWith('feature', 'main');
});

test('checkout switches branch', async () => {
  await git.checkout('main');
  expect(mockGit.checkout).toHaveBeenCalledWith('main');
});

test('merge merges branch with message', async () => {
  await git.merge('feature', 'Merge feature');
  expect(mockGit.merge).toHaveBeenCalledWith(['feature', '--no-ff', '-m', 'Merge feature']);
});

test('abortMerge aborts current merge', async () => {
  await git.abortMerge();
  expect(mockGit.merge).toHaveBeenCalledWith(['--abort']);
});

test('getBranches returns local branches', async () => {
  const branches = await git.getBranches();
  expect(branches).toEqual(['main', 'feature']);
});

test('commit adds files and commits', async () => {
  await git.commit(['a.ts'], 'msg');
  expect(mockGit.add).toHaveBeenCalledWith(['a.ts']);
  expect(mockGit.commit).toHaveBeenCalledWith('msg');
});

test('stash pushes stash', async () => {
  await git.stash();
  expect(mockGit.stash).toHaveBeenCalledWith(['push', '-m', 'MAFW auto-stash']);
});
