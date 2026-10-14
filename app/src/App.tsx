import { Routes, Route, Navigate } from 'react-router'
import { StoreProvider } from './lib/store'
import { SocketProvider } from './lib/socket'
import { Layout } from './components/chrome'
import Home from './pages/Home'
import Lobby from './pages/Lobby'
import TablePage from './pages/TablePage'
import DailyEvent from './pages/DailyEvent'
import Scoring from './pages/Scoring'
import Systems from './pages/Systems'
import Profile from './pages/Profile'

export default function App() {
  return (
    <StoreProvider>
      <SocketProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Home />} />
            <Route path="/lobby" element={<Lobby />} />
            <Route path="/table/:id" element={<TablePage />} />
            <Route path="/event/daily" element={<DailyEvent />} />
            <Route path="/scoring" element={<Scoring />} />
            <Route path="/systems" element={<Systems />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </SocketProvider>
    </StoreProvider>
  )
}
