import { useState, useEffect } from 'react';
import type { Goal } from '../types';
import { fetchGoals } from '../api/goals';
import { useGoalStore } from '../stores/goalStore';

export function useGoals() {
  const [loading, setLoading] = useState(true);
  const setGoals = useGoalStore((s) => s.setGoals);
  const goals = useGoalStore((s) => s.goals);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const data = await fetchGoals();
      setGoals(data);
      setLoading(false);
    };
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [setGoals]);

  return { goals, loading };
}
