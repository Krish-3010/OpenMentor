import { useEffect, useMemo, useState } from 'react'
import './App.css'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

async function readResponse(response) {
  const text = await response.text()
  if (!text) {
    throw new Error(`The server returned an empty response (${response.status}).`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`The server returned an invalid response (${response.status}).`)
  }
}

const emptyRequest = {
  juniorName: '',
  email: '',
  goal: '',
  preferredTime: '',
}

function App() {
  const [page, setPage] = useState('home')
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [scrollY, setScrollY] = useState(0)
  const [authMode, setAuthMode] = useState('register')
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = localStorage.getItem('openmentor_user')
      return saved ? JSON.parse(saved) : null
    } catch {
      return null
    }
  })
  const [mentors, setMentors] = useState([])
  const [requests, setRequests] = useState([])
  const [activeSkill, setActiveSkill] = useState('All')
  const [query, setQuery] = useState('')
  const [selectedMentor, setSelectedMentor] = useState(null)
  const [requestForm, setRequestForm] = useState(emptyRequest)
  const [authForm, setAuthForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'Junior',
  })
  const [notice, setNotice] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isAvailabilityUpdating, setIsAvailabilityUpdating] = useState(false)
  const [isProfileUpdating, setIsProfileUpdating] = useState(false)

  useEffect(() => {
    if (currentUser) {
      try {
        localStorage.setItem('openmentor_user', JSON.stringify(currentUser))
      } catch {
        // localStorage quota / security limit fallback
      }
    } else {
      localStorage.removeItem('openmentor_user')
    }
  }, [currentUser])

  const refreshMentors = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/mentors/`)
      if (!response.ok) return
      const mentorData = await readResponse(response)
      setMentors(mentorData.mentors || [])
    } catch {
      // silent fallback
    }
  }

  useEffect(() => {
    const controller = new AbortController()

    async function loadData() {
      try {
        const response = await fetch(`${API_BASE_URL}/mentors/`, { signal: controller.signal })
        if (!response.ok) {
          throw new Error('API unavailable')
        }
        const mentorData = await readResponse(response)
        const fetched = mentorData.mentors || []
        setMentors(fetched)
        setSelectedMentor((prev) => prev || fetched[0] || null)
      } catch (error) {
        if (error.name !== 'AbortError') {
          setNotice('Unable to load mentors. Please try again when the service is available.')
        }
      }
    }

    loadData()

    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!currentUser?.id) return undefined
    fetch(`${API_BASE_URL}/requests/?userId=${currentUser.id}&role=${currentUser.role}`)
      .then(async (response) => {
        const data = await readResponse(response)
        if (!response.ok) throw new Error(data.error || 'Request load failed')
        return data
      })
      .then((data) => setRequests(data.requests || []))
      .catch(() => setNotice('Unable to load requests right now.'))
    return undefined
  }, [currentUser])

  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const skills = useMemo(() => {
    const allSkills = mentors.flatMap((mentor) => mentor.skills || [])
    return ['All', ...Array.from(new Set(allSkills))]
  }, [mentors])

  const filteredMentors = useMemo(() => {
    return mentors.filter((mentor) => {
      const mentorSkills = mentor.skills || []
      const matchesSkill = activeSkill === 'All' || mentorSkills.includes(activeSkill)
      const searchText = `${mentor.name || ''} ${mentor.role || ''} ${mentorSkills.join(' ')} ${mentor.bio || ''}`.toLowerCase()
      return matchesSkill && searchText.includes(query.toLowerCase())
    })
  }, [activeSkill, mentors, query])

  const stats = [
    { label: 'Available mentors', value: mentors.length },
    { label: 'Sessions hosted', value: mentors.reduce((total, mentor) => total + (mentor.sessions || 0), 0) },
    { label: 'Open requests', value: requests.filter((request) => request.status === 'Requested').length },
  ]

  function goToAuth(mode = 'register') {
    setAuthMode(mode)
    setPage('auth')
  }

  function handleGetStarted() {
    if (currentUser) {
      setPage(currentUser.role === 'senior' ? 'requests' : 'mentors')
      return
    }
    goToAuth('register')
  }

  function handleAuthSubmit(event) {
    event.preventDefault()
    const displayName = authForm.name || authForm.email.split('@')[0] || 'Student'
    const role = authForm.role === 'Senior mentor' ? 'senior' : 'junior'
    fetch(`${API_BASE_URL}/auth/${authMode === 'login' ? 'login' : 'register'}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...authForm, name: displayName, role }),
    })
      .then(async (response) => {
        const data = await readResponse(response)
        if (!response.ok) throw new Error(data.error || 'Authentication failed')
        setCurrentUser(data.user)
        setNotice(`${authMode === 'login' ? 'Logged in' : 'Registered'} as ${data.user.name}.`)
        setPage(data.user.role === 'senior' ? 'requests' : 'mentors')
        refreshMentors()
      })
      .catch((error) => setNotice(error.message))
  }

  function handleLogout() {
    setCurrentUser(null)
    setNotice('Logged out successfully.')
    setPage('home')
  }

  function beginRequest(mentor) {
    if (currentUser?.role === 'senior') {
      setNotice('Senior mentors review incoming requests from the Requests page.')
      setPage('requests')
      return
    }
    setSelectedMentor(mentor)
    if (!currentUser) {
      setNotice('Create an account or log in before sending a mentorship request.')
      goToAuth('register')
      return
    }
    setPage('requests')
  }

  async function handleRequestSubmit(event) {
    event.preventDefault()

    if (!currentUser) {
      goToAuth('register')
      return
    }

    if (!selectedMentor) {
      setNotice('Please select a mentor to send a request.')
      return
    }

    setIsSubmitting(true)
    setNotice('')

    const payload = {
      ...requestForm,
      juniorId: currentUser.id,
      mentorId: selectedMentor.id,
      mentorName: selectedMentor.name,
    }

    try {
      const response = await fetch(`${API_BASE_URL}/requests/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await readResponse(response)
      if (!response.ok) {
        throw new Error(data.error || 'Request failed')
      }
      setRequests((current) => [data.request, ...current])
      setNotice('Mentorship request sent. The senior can now review it.')
    } catch (error) {
      setNotice(error.message || 'Could not save the request.')
    } finally {
      setRequestForm({
        ...emptyRequest,
        juniorName: currentUser.name,
        email: currentUser.email,
      })
      setIsSubmitting(false)
    }
  }

  async function updateRequest(requestId, status) {
    try {
      const response = await fetch(`${API_BASE_URL}/requests/${requestId}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, seniorId: currentUser.id }),
      })
      const data = await readResponse(response)
      if (!response.ok) {
        throw new Error(data.error || 'Could not update request')
      }
      setRequests((current) => current.map((item) => item.id === requestId ? { ...item, status } : item))
      setNotice(`Request status updated to ${status}.`)
      refreshMentors()
    } catch (error) {
      setNotice(error.message)
    }
  }

  async function toggleAvailability() {
    setIsAvailabilityUpdating(true)
    try {
      const available = !currentUser.available
      const response = await fetch(`${API_BASE_URL}/users/${currentUser.id}/availability/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ available }),
      })
      const data = await readResponse(response)
      if (!response.ok) throw new Error(data.error || 'Could not update availability')
      setCurrentUser((current) => ({ ...current, available: data.available }))
      setNotice(`You are now ${available ? 'available' : 'unavailable'} for mentorship.`)
      refreshMentors()
    } catch (error) {
      setNotice(error.message)
    } finally {
      setIsAvailabilityUpdating(false)
    }
  }

  async function handleProfileUpdate(profilePayload) {
    setIsProfileUpdating(true)
    try {
      const response = await fetch(`${API_BASE_URL}/users/${currentUser.id}/profile/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profilePayload),
      })
      const data = await readResponse(response)
      if (!response.ok) throw new Error(data.error || 'Could not update profile')
      setCurrentUser(data.user)
      setNotice('Profile updated successfully.')
      refreshMentors()
    } catch (error) {
      setNotice(error.message)
    } finally {
      setIsProfileUpdating(false)
    }
  }

  return (
    <main className="app-shell">
      <header className={`topbar ${scrollY > 24 ? 'topbar-scrolled' : ''}`} aria-label="OpenMentor navigation">
        <button className="brand" type="button" onClick={() => setPage('home')} aria-label="OpenMentor home">
          <span className="brand-mark">
            <img src="/logo.png" alt="OpenMentor logo" />
          </span>
          <span>OpenMentor</span>
        </button>

        <button
          className="menu-toggle"
          type="button"
          aria-expanded={isMenuOpen}
          aria-label="Toggle navigation"
          onClick={() => setIsMenuOpen((open) => !open)}
        >
          <span />
          <span />
        </button>

        <nav className={isMenuOpen ? 'nav-open' : ''}>
          <button type="button" className={page === 'home' ? 'active' : ''} onClick={() => { setPage('home'); setIsMenuOpen(false) }}>
            Home
          </button>
          {currentUser?.role !== 'senior' && (
            <button type="button" className={page === 'mentors' ? 'active' : ''} onClick={() => { setPage('mentors'); setIsMenuOpen(false) }}>
              Mentors
            </button>
          )}
          <button
            type="button"
            className={page === 'requests' ? 'active' : ''}
            onClick={() => { currentUser ? setPage('requests') : goToAuth('register'); setIsMenuOpen(false) }}
          >
            Requests
          </button>
          {currentUser ? (
            <button type="button" className={page === 'profile' ? 'active' : ''} onClick={() => { setPage('profile'); setIsMenuOpen(false) }}>
              Profile
            </button>
          ) : (
            <button type="button" className={page === 'auth' ? 'active' : ''} onClick={() => { goToAuth('login'); setIsMenuOpen(false) }}>
              Login/Register
            </button>
          )}
        </nav>
      </header>

      {notice && <p className="notice" role="status">{notice}</p>}

      <div className="page-stage" key={page}>
        {page === 'home' && (
          <LandingPage
            currentUser={currentUser}
            stats={stats}
            onGetStarted={handleGetStarted}
            onExplore={() => setPage(currentUser?.role === 'senior' ? 'requests' : 'mentors')}
          />
        )}

        {page === 'mentors' && currentUser?.role !== 'senior' && (
          <MentorsPage
            activeSkill={activeSkill}
            filteredMentors={filteredMentors}
            query={query}
            selectedMentor={selectedMentor}
            skills={skills}
            onQueryChange={setQuery}
            onRequest={beginRequest}
            onSkillChange={setActiveSkill}
          />
        )}

        {page === 'requests' && (
          <RequestsPage
            currentUser={currentUser}
            form={requestForm}
            isSubmitting={isSubmitting}
            mentors={mentors}
            selectedMentor={selectedMentor}
            requests={requests}
            onSelectMentor={setSelectedMentor}
            onUpdateRequest={updateRequest}
            onAuth={() => goToAuth('register')}
            onFormChange={setRequestForm}
            onSubmit={handleRequestSubmit}
          />
        )}

        {page === 'auth' && (
          <AuthPage
            authForm={authForm}
            authMode={authMode}
            onAuthModeChange={setAuthMode}
            onFormChange={setAuthForm}
            onSubmit={handleAuthSubmit}
          />
        )}

        {page === 'profile' && (
          <ProfilePage
            currentUser={currentUser}
            onLogout={handleLogout}
            onMentors={() => setPage('mentors')}
            onToggleAvailability={toggleAvailability}
            isAvailabilityUpdating={isAvailabilityUpdating}
            onUpdateProfile={handleProfileUpdate}
            isProfileUpdating={isProfileUpdating}
          />
        )}
      </div>
    </main>
  )
}

function LandingPage({ currentUser, stats, onExplore, onGetStarted }) {
  const [storyProgress, setStoryProgress] = useState(0)

  useEffect(() => {
    const section = document.querySelector('.story-section')
    if (!section) return undefined

    const updateProgress = () => {
      const bounds = section.getBoundingClientRect()
      const distance = Math.max(1, bounds.height - window.innerHeight)
      setStoryProgress(Math.min(1, Math.max(0, -bounds.top / distance)))
    }
    updateProgress()
    window.addEventListener('scroll', updateProgress, { passive: true })
    return () => window.removeEventListener('scroll', updateProgress)
  }, [])

  const storySteps = [
    ['01', 'Find the right mentor', 'Filter by the skills, timing, and energy you need for your next unlock.'],
    ['02', 'Learn from real experience', 'Get practical context from someone who has already shipped, studied, and stumbled.'],
    ['03', 'Build meaningful connections', 'Turn one focused session into an ongoing support system for your journey.'],
  ]
  const activeStory = Math.min(2, Math.floor(storyProgress * 3))

  return (
    <>
      <section className="landing-page">
        <div className="landing-copy">
          <p className="eyebrow">Peer mentorship for juniors and seniors</p>
          <h1>Meet the senior who can unblock your next project.</h1>
          <p>
            OpenMentor helps juniors discover seniors, request focused guidance, and keep mentorship
            sessions organized from the first message.
          </p>
          <div className="quick-actions">
            <button className="primary-action" type="button" onClick={onGetStarted}>
              Get started <span className="button-arrow">↗</span>
            </button>
            <button className="secondary-action" type="button" onClick={onExplore}>
              Explore mentors <span className="button-arrow">→</span>
            </button>
          </div>
        </div>

        <aside className="hero-stage" aria-label="OpenMentor summary">
          <div className="hero-orbit orbit-one" />
          <div className="hero-orbit orbit-two" />
          <div className="hero-object">
            <img src="/logo.png" alt="OpenMentor logo" />
            <span className="hero-spark">✦</span>
          </div>
          <div className="floating-card floating-card-top">
            <span className="mini-avatar">OM</span>
            <span><strong>Mentors are available</strong><small>Find guidance for your next step</small></span>
          </div>
          <div className="floating-card floating-card-bottom">
            <span className="signal-dot" /> <strong>{stats[1].value} sessions hosted</strong>
          </div>
        </aside>
      </section>

      <section className="story-section" aria-label="How OpenMentor works">
        <div className="story-visual">
          <div className="story-visual-inner" style={{
            transform: `translate3d(${storyProgress * 10}px, ${storyProgress * -18}px, 0) rotate(${storyProgress * 7 - 3}deg) scale(${1 + storyProgress * 0.08})`,
          }}>
            <img src="/logo.png" alt="OpenMentor logo" />
            <div className="story-ring" />
            <span className="story-number">0{activeStory + 1}</span>
          </div>
        </div>
        <div className="story-copy">
          <p className="eyebrow">One journey, three unlocks</p>
          {storySteps.map(([number, title, description], index) => (
            <article className={`story-step ${activeStory === index ? 'is-active' : ''}`} key={number}>
              <span>{number}</span>
              <div><h2>{title}</h2><p>{description}</p></div>
            </article>
          ))}
        </div>
      </section>

      <section className="feature-bento">
        <div className="section-heading">
          <div><p className="eyebrow">A better way to grow</p><h2>Mentorship that moves at your pace.</h2></div>
        </div>
        <div className="bento-grid">
          <div className="bento-card feature-card feature-wide"><strong>Mentor match</strong><span>Skill filters, request tracking, and session context in one place.</span><span className="feature-glyph">↗</span></div>
          <div className="bento-card stat feature-stat"><strong>{stats[0].value}</strong><span>Available mentors</span></div>
          <div className="bento-card welcome-card feature-welcome"><span>{currentUser ? `Welcome, ${currentUser.name}` : 'Campus mentoring hub'}</span><strong>Built for momentum</strong></div>
          <div className="bento-card stat feature-stat"><strong>{stats[1].value}</strong><span>Sessions hosted</span></div>
        </div>
      </section>
    </>
  )
}

function MentorsPage({
  activeSkill,
  filteredMentors,
  query,
  selectedMentor,
  skills,
  onQueryChange,
  onRequest,
  onSkillChange,
}) {
  return (
    <section className="page-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Mentors</p>
          <h2>Find seniors by skill, timing, and track record.</h2>
        </div>
        <label className="search-box">
          <span>Search</span>
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Python, DSA, UI..."
          />
        </label>
      </div>

      <div className="skill-tabs" role="tablist" aria-label="Filter mentors by skill">
        {skills.map((skill) => (
          <button
            type="button"
            key={skill}
            className={activeSkill === skill ? 'active' : ''}
            onClick={() => onSkillChange(skill)}
          >
            {skill}
          </button>
        ))}
      </div>

      <div className="mentor-grid">
        {filteredMentors.length === 0 && (
          <div className="empty-state">
            <p className="eyebrow">No mentors found</p>
            <h2>{query || activeSkill !== 'All' ? 'Try a different search or skill.' : 'No mentors are available right now.'}</h2>
          </div>
        )}
        {filteredMentors.map((mentor) => (
          <article
            className={`mentor-card ${selectedMentor?.id === mentor.id ? 'selected' : ''}`}
            key={mentor.id}
          >
            <div className="mentor-card-header">
              <div className="avatar" aria-hidden="true">{mentor.name.slice(0, 2).toUpperCase()}</div>
              <div>
                <h3>{mentor.name}</h3>
                <p>{mentor.role}</p>
              </div>
            </div>
            <p className="mentor-bio">{mentor.bio || 'Senior mentor ready to guide students.'}</p>
            <div className="tags">
              {(mentor.skills || []).map((skill) => <span key={skill}>{skill}</span>)}
            </div>
            <dl className="mentor-meta">
              <div>
                <dt>Rating</dt>
                <dd>{mentor.rating ?? 5.0}</dd>
              </div>
              <div>
                <dt>Mode</dt>
                <dd>{mentor.mode || 'Online'}</dd>
              </div>
              <div>
                <dt>Next slot</dt>
                <dd>{mentor.availability || 'Available'}</dd>
              </div>
            </dl>
            <button type="button" onClick={() => onRequest(mentor)}>
              Request mentorship
            </button>
          </article>
        ))}
      </div>
    </section>
  )
}

function RequestsPage({
  currentUser,
  form,
  isSubmitting,
  mentors,
  selectedMentor,
  requests,
  onSelectMentor,
  onUpdateRequest,
  onAuth,
  onFormChange,
  onSubmit,
}) {
  if (!currentUser) {
    return (
      <section className="empty-state">
        <p className="eyebrow">Requests</p>
        <h2>Log in or register to send mentorship requests.</h2>
        <button className="primary-action" type="button" onClick={onAuth}>
          Go to registration
        </button>
      </section>
    )
  }

  if (currentUser.role === 'senior') {
    return (
      <section className="page-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Incoming requests</p>
            <h2>Review juniors who want your guidance.</h2>
          </div>
        </div>
        <RequestList requests={requests} isSenior onUpdateRequest={onUpdateRequest} />
      </section>
    )
  }

  return (
    <section className="page-section">
      <div className="request-layout">
        <div>
          <p className="eyebrow">Selected mentor</p>
          <h2>{selectedMentor?.name || 'Select a mentor'}</h2>
          <p>
            {selectedMentor
              ? `${selectedMentor.name} is available ${selectedMentor.availability ? selectedMentor.availability.toLowerCase() : 'for mentorship'} (${(selectedMentor.mode || 'Online').toLowerCase()}).`
              : 'Pick a mentor below to request guidance.'}
          </p>

          <label className="search-box" style={{ marginTop: '20px' }}>
            <span>Change Mentor</span>
            <select
              value={selectedMentor?.id || ''}
              onChange={(e) => {
                const found = mentors.find((m) => m.id === e.target.value)
                if (found) onSelectMentor(found)
              }}
            >
              <option value="" disabled>-- Select a Mentor --</option>
              {mentors.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.mode || 'Online'})
                </option>
              ))}
            </select>
          </label>
        </div>

        <form className="request-form" onSubmit={onSubmit}>
          <label>
            Your name
            <input
              required
              value={form.juniorName}
              onChange={(event) => onFormChange({ ...form, juniorName: event.target.value })}
              placeholder="Your full name"
            />
          </label>
          <label>
            Email
            <input
              required
              type="email"
              value={form.email}
              onChange={(event) => onFormChange({ ...form, email: event.target.value })}
              placeholder="you@college.edu"
            />
          </label>
          <label>
            Mentorship goal
            <textarea
              required
              value={form.goal}
              onChange={(event) => onFormChange({ ...form, goal: event.target.value })}
              placeholder="Tell the senior what topics or projects you need help with."
              rows="4"
            />
          </label>
          <label>
            Preferred time
            <input
              required
              value={form.preferredTime}
              onChange={(event) => onFormChange({ ...form, preferredTime: event.target.value })}
              placeholder="e.g. Weekdays after 5 PM"
            />
          </label>
          <button type="submit" disabled={isSubmitting || !selectedMentor}>
            {isSubmitting ? 'Sending...' : 'Send request'}
          </button>
        </form>
      </div>

      <RequestList requests={requests} />
    </section>
  )
}

function AuthPage({ authForm, authMode, onAuthModeChange, onFormChange, onSubmit }) {
  const isLogin = authMode === 'login'

  return (
    <section className="auth-layout">
      <div>
        <p className="eyebrow">{isLogin ? 'Welcome back' : 'Create account'}</p>
        <h2>{isLogin ? 'Log in to continue mentorship.' : 'Register before requesting a mentor.'}</h2>
        <p>
          Create an account to find mentors, send requests, and manage your mentoring availability.
        </p>
      </div>

      <form className="auth-form" onSubmit={onSubmit}>
        <div className="auth-switch" role="tablist" aria-label="Authentication mode">
          <button
            type="button"
            className={!isLogin ? 'active' : ''}
            onClick={() => onAuthModeChange('register')}
          >
            Register
          </button>
          <button
            type="button"
            className={isLogin ? 'active' : ''}
            onClick={() => onAuthModeChange('login')}
          >
            Login
          </button>
        </div>

        {!isLogin && (
          <label>
            Full name
            <input
              required
              value={authForm.name}
              onChange={(event) => onFormChange({ ...authForm, name: event.target.value })}
              placeholder="Alex Johnson"
            />
          </label>
        )}
        <label>
          Email
          <input
            required
            type="email"
            value={authForm.email}
            onChange={(event) => onFormChange({ ...authForm, email: event.target.value })}
            placeholder="you@college.edu"
          />
        </label>
        <label>
          Password
          <input
            required
            type="password"
            value={authForm.password}
            onChange={(event) => onFormChange({ ...authForm, password: event.target.value })}
            placeholder="Minimum 8 characters"
            minLength="8"
          />
        </label>
        {!isLogin && (
          <label>
            I am a
            <select
              value={authForm.role}
              onChange={(event) => onFormChange({ ...authForm, role: event.target.value })}
            >
              <option value="Junior">Junior</option>
              <option value="Senior mentor">Senior mentor</option>
            </select>
          </label>
        )}
        <button type="submit">{isLogin ? 'Login' : 'Create account'}</button>
      </form>
    </section>
  )
}

function ProfilePage({
  currentUser,
  onLogout,
  onMentors,
  onToggleAvailability,
  isAvailabilityUpdating,
  onUpdateProfile,
  isProfileUpdating,
}) {
  const [profileData, setProfileData] = useState({
    name: currentUser?.name || '',
    bio: currentUser?.bio || '',
    skills: Array.isArray(currentUser?.skills) ? currentUser.skills.join(', ') : currentUser?.skills || '',
    mode: currentUser?.mode || 'Online',
    availability: currentUser?.availability || 'Available for mentorship',
  })

  if (!currentUser) {
    return null
  }

  const isSenior = currentUser.role === 'senior'

  const handleSubmit = (e) => {
    e.preventDefault()
    onUpdateProfile(profileData)
  }

  return (
    <section className="profile-layout">
      <div className="profile-card">
        <div className="avatar large" aria-hidden="true">{(currentUser.name || 'OM').slice(0, 2).toUpperCase()}</div>
        <div>
          <p className="eyebrow">Profile</p>
          <h2>{currentUser.name}</h2>
          <p>{currentUser.email}</p>
          <p style={{ textTransform: 'capitalize' }}>{currentUser.role} Account</p>
        </div>
        <div className="profile-actions">
          {!isSenior && <button className="secondary-action" type="button" onClick={onMentors}>Browse mentors</button>}
          {isSenior && (
            <button className="secondary-action" type="button" onClick={onToggleAvailability} disabled={isAvailabilityUpdating}>
              {currentUser.available ? 'Turn availability off' : 'Turn availability on'}
            </button>
          )}
          <button className="primary-action" type="button" onClick={onLogout}>
            Logout
          </button>
        </div>
      </div>

      <div className="landing-copy" style={{ minHeight: 'auto', padding: '28px' }}>
        <p className="eyebrow">Edit Profile Details</p>
        <h2>Update Information</h2>
        <form className="request-form" onSubmit={handleSubmit} style={{ marginTop: '16px' }}>
          <label>
            Full Name
            <input
              required
              value={profileData.name}
              onChange={(e) => setProfileData({ ...profileData, name: e.target.value })}
            />
          </label>
          <label>
            Bio
            <input
              value={profileData.bio}
              onChange={(e) => setProfileData({ ...profileData, bio: e.target.value })}
              placeholder="Brief introduction or background..."
            />
          </label>

          {isSenior && (
            <>
              <label>
                Skills (comma-separated)
                <input
                  value={profileData.skills}
                  onChange={(e) => setProfileData({ ...profileData, skills: e.target.value })}
                  placeholder="Python, Data Structures, Web Development"
                />
              </label>
              <label>
                Mentorship Mode
                <select
                  value={profileData.mode}
                  onChange={(e) => setProfileData({ ...profileData, mode: e.target.value })}
                >
                  <option value="Online">Online</option>
                  <option value="In-Person">In-Person</option>
                  <option value="Hybrid">Hybrid</option>
                </select>
              </label>
              <label style={{ gridColumn: '1 / -1' }}>
                Availability Note / Slot
                <input
                  value={profileData.availability}
                  onChange={(e) => setProfileData({ ...profileData, availability: e.target.value })}
                  placeholder="e.g. Weekdays 4 PM - 6 PM"
                />
              </label>
            </>
          )}

          <button type="submit" disabled={isProfileUpdating}>
            {isProfileUpdating ? 'Saving...' : 'Save Profile Changes'}
          </button>
        </form>
      </div>
    </section>
  )
}

function RequestList({ requests, isSenior = false, onUpdateRequest }) {
  return (
    <section className="sessions-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Requests</p>
          <h2>Track requests from first ask to completed session.</h2>
        </div>
      </div>
      <div className="session-list">
        {requests.length === 0 && <p className="empty-state">No requests yet.</p>}
        {requests.map((request) => (
          <article className="session-row" key={request.id}>
            <div>
              <strong>{request.goal}</strong>
              <span>{request.juniorName} with {request.mentorName} · {request.preferredTime}</span>
            </div>
            {isSenior ? (
              <div className="request-actions">
                {request.status === 'Requested' && (
                  <>
                    <button type="button" onClick={() => onUpdateRequest(request.id, 'Accepted')}>Accept</button>
                    <button type="button" onClick={() => onUpdateRequest(request.id, 'Rejected')}>Reject</button>
                  </>
                )}
                {request.status === 'Accepted' && (
                  <button type="button" onClick={() => onUpdateRequest(request.id, 'Completed')}>Mark Completed</button>
                )}
                {request.status !== 'Requested' && request.status !== 'Accepted' && (
                  <span className={`status ${request.status.toLowerCase()}`}>{request.status}</span>
                )}
              </div>
            ) : <span className={`status ${request.status.toLowerCase()}`}>{request.status}</span>}
          </article>
        ))}
      </div>
    </section>
  )
}

export default App
