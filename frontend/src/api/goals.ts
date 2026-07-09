import type { Goal } from '../types';

export async function fetchGoals(): Promise<Goal[]> {
  const res = await fetch('/api/goals');
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : (data.goals || []);
}

export async function fetchGoalDetail(goalId: string): Promise<Goal | null> {
  const res = await fetch(`/api/goals/${goalId}`);
  if (!res.ok) return null;
  return res.json();
}
