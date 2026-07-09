import { create } from 'zustand';
import type { Goal } from '../types';

interface GoalState {
  currentGoalId: string | null;
  goals: Goal[];
  setGoalId: (id: string | null) => void;
  setGoals: (goals: Goal[]) => void;
}

export const useGoalStore = create<GoalState>((set) => ({
  currentGoalId: null,
  goals: [],
  setGoalId: (id) => set({ currentGoalId: id }),
  setGoals: (goals) => set({ goals }),
}));
