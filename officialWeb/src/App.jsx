import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import Navbar from './components/Navbar.jsx'
import Footer from './components/Footer.jsx'
import Home from './pages/Home.jsx'
import Docs from './pages/Docs.jsx'
import Download from './pages/Download.jsx'
import Stats from './pages/Stats.jsx'
import { THEME_STORAGE_KEY, applyTheme, getInitialTheme } from './lib/theme.js'
import { reportVisit } from './lib/visits.js'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

// 页面访问上报：每次路由切换（含首次加载）记一次 PV。
function VisitReporter() {
  const { pathname } = useLocation()
  useEffect(() => {
    reportVisit(pathname)
  }, [pathname])
  return null
}

export default function App() {
  const [theme, setTheme] = useState(getInitialTheme)

  useEffect(() => {
    applyTheme(theme)
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
  }

  return (
    <BrowserRouter>
      <ScrollToTop />
      <VisitReporter />
      <div className="min-h-screen flex flex-col bg-bg text-[rgb(var(--color-text))] transition-colors">
        <Navbar theme={theme} onToggleTheme={toggleTheme} />
        <main className="flex-1">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/download" element={<Download />} />
            <Route path="/docs" element={<Docs />} />
            <Route path="/docs/:slug" element={<Docs />} />
            <Route path="/stats" element={<Stats />} />
          </Routes>
        </main>
        <Footer />
      </div>
    </BrowserRouter>
  )
}
