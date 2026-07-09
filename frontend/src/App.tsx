import { Sidebar } from './components/layout/Sidebar';
import { MainArea } from './components/layout/MainArea';

export default function App() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <MainArea />
    </div>
  );
}
