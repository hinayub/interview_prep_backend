import { Navigate, Route, Routes } from 'react-router-dom'

import AppShell from './components/AppShell'
import RequireAuth from './components/RequireAuth'
import CreateAccount from './pages/CreateAccount'
import Home from './pages/Home'
import Interview from './pages/Interview'
import MatchReport from './pages/MatchReport'
import SignIn from './pages/SignIn'
import UploadResume from './pages/UploadResume'

export default function App() {
  return (
    <Routes>
      {/* The landing page is public: it is what sends people to sign up. */}
      <Route path="/" element={<Home />} />
      <Route path="/sign-in" element={<SignIn />} />
      <Route path="/create-account" element={<CreateAccount />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/app" element={<UploadResume />} />
          <Route path="/app/match" element={<MatchReport />} />
          <Route path="/app/interview" element={<Interview />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
