"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Send, Activity, Brain, FileText, Settings, LogOut, Terminal, Layers, Globe, Zap, User, Copy, RotateCcw, Clock, CheckCircle2, Circle, Loader2, Trash2, ArrowRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { SignInButton, UserButton, SignedIn, SignedOut, useUser, useClerk } from "@clerk/nextjs";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type AgentEvent = { node: string; update: any };

const AGENT_META: Record<string, { label: string; icon: string; colorClass: string; cardClass: string }> = {
  generate_queries: { label: "Query Engine", icon: "🔍", colorClass: "", cardClass: "" },
  retrieve_documents: { label: "Intelligence", icon: "📡", colorClass: "", cardClass: "" },
  bull_analyst: { label: "Bull Analyst", icon: "🟢", colorClass: "node-bull", cardClass: "thought-bull" },
  bear_analyst: { label: "Bear Analyst", icon: "🔴", colorClass: "node-bear", cardClass: "thought-bear" },
  data_analyst: { label: "Data Analyst", icon: "📊", colorClass: "text-blue-400", cardClass: "border-blue-500 bg-blue-500/10" },
  critic: { label: "Critic", icon: "🔍", colorClass: "node-critic", cardClass: "thought-critic" },
  synthesize: { label: "Executive", icon: "⚡", colorClass: "node-executive", cardClass: "thought-executive" },
};

// Pipeline stage order for the visual tracker
const PIPELINE_STAGES = ["generate_queries", "retrieve_documents", "bull_analyst", "bear_analyst", "data_analyst", "critic", "synthesize"];

export default function Page() {
  const { isSignedIn } = useUser();
  const { signOut } = useClerk();
  const [company, setCompany] = useState("");
  const [question, setQuestion] = useState("");
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [finalReport, setFinalReport] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [activeNode, setActiveNode] = useState<string>("");
  const [startTime, setStartTime] = useState<number>(0);
  const [elapsed, setElapsed] = useState<number>(0);
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [currentView, setCurrentView] = useState<"dashboard" | "ledger" | "search" | "terminal">("dashboard");
  const [reportsList, setReportsList] = useState<any[]>([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [streamingText, setStreamingText] = useState<Record<string, string>>({});

  // Terminal State
  const [terminalInput, setTerminalInput] = useState("");
  const [terminalLogs, setTerminalLogs] = useState<{type: 'cmd' | 'stdout' | 'stderr' | 'chart', content: string}[]>([]);
  const [terminalRunning, setTerminalRunning] = useState(false);
  const terminalScrollRef = useRef<HTMLDivElement>(null);

  // Web Search State
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResult, setSearchResult] = useState("");
  const [searchRunning, setSearchRunning] = useState(false);

  const loadReports = async () => {
    setLoadingReports(true);
    try {
      const res = await fetch("http://localhost:4000/reports");
      const data = await res.json();
      setReportsList(data);
    } catch (e) {
      console.error("Failed to load reports", e);
    }
    setLoadingReports(false);
  };

  const deleteReport = async (id: string) => {
    try {
      await fetch(`http://localhost:4000/reports/${id}`, { method: "DELETE" });
      setReportsList(prev => prev.filter(r => r.id !== id));
    } catch (e) {
      console.error("Failed to delete report", e);
    }
  };

  const loadPastReport = async (id: string) => {
    try {
      const res = await fetch(`http://localhost:4000/reports/${id}`);
      const data = await res.json();
      setCompany(data.company);
      setQuestion(data.question);
      setFinalReport(data.synthesis);
      setCurrentView("dashboard");
    } catch (e) {
      console.error("Failed to load past report", e);
    }
  };

  const runTerminalCommand = async () => {
    if (!terminalInput.trim() || terminalRunning) return;
    const cmd = terminalInput;
    setTerminalInput("");
    setTerminalLogs(prev => [...prev, { type: 'cmd', content: cmd }]);
    setTerminalRunning(true);
    
    try {
      const res = await fetch("http://localhost:4000/terminal/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: cmd })
      });
      const data = await res.json();
      
      if (data.stdout) setTerminalLogs(prev => [...prev, { type: 'stdout', content: data.stdout }]);
      if (data.stderr) setTerminalLogs(prev => [...prev, { type: 'stderr', content: data.stderr }]);
      if (data.chart) setTerminalLogs(prev => [...prev, { type: 'chart', content: data.chart }]);
    } catch (e) {
      setTerminalLogs(prev => [...prev, { type: 'stderr', content: "Failed to connect to Terminal Sandbox." }]);
    }
    setTerminalRunning(false);
  };

  const runWebSearch = async () => {
    if (!searchQuery.trim() || searchRunning) return;
    setSearchRunning(true);
    setSearchResult("");
    
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      
      const res = await fetch("http://localhost:4000/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery }),
        signal: controller.signal
      });
      clearTimeout(timeout);
      
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setSearchResult(`**Search Error (${res.status}):** ${errData.error || res.statusText}. Make sure your API server is running and TAVILY_API_KEY + COHERE_API_KEY are set in your .env file.`);
        setSearchRunning(false);
        return;
      }
      
      const data = await res.json();
      if (data.error) {
        setSearchResult(`**Backend Error:** ${data.error}`);
      } else if (data.answer && typeof data.answer === "string" && data.answer.trim()) {
        setSearchResult(data.answer);
      } else {
        setSearchResult("**No results found.** The search completed but returned no content. Try rephrasing your query.");
      }
    } catch (e: any) {
      if (e.name === "AbortError") {
        setSearchResult("**Timeout:** The search took too long (>30s). The backend may be slow or unresponsive.");
      } else {
        setSearchResult(`**Connection Error:** Could not reach the API server at localhost:4000. Make sure the backend is running with \`npm run dev\` in the \`apps/api\` directory.`);
      }
    }
    setSearchRunning(false);
  };

  useEffect(() => {
    if (scrollRef.current) {
      // Small timeout allows framer-motion to render the new item's layout
      const timeout = setTimeout(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTo({
            top: scrollRef.current.scrollHeight,
            behavior: "smooth"
          });
        }
      }, 100);
      return () => clearTimeout(timeout);
    }
  }, [events]);

  useEffect(() => {
    if (terminalScrollRef.current) {
      terminalScrollRef.current.scrollTop = terminalScrollRef.current.scrollHeight;
    }
  }, [terminalLogs]);

  // Live timer
  useEffect(() => {
    if (running && startTime > 0) {
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTime) / 1000));
      }, 500);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [running, startTime]);

  const canRun = useMemo(() => company.trim().length > 0 && question.trim().length > 0, [company, question]);

  const completedNodes = useMemo(() => new Set(events.map(e => e.node)), [events]);

  const run = useCallback(() => {
    if (!isSignedIn) {
      alert("Please sign in to run an autonomous analysis.");
      return;
    }
    if (!canRun || running) return;
    
    setRunning(true);
    setEvents([]);
    setFinalReport("");
    setActiveNode("generate_queries");
    setStartTime(Date.now());
    setElapsed(0);
    setErrorMsg("");

    const contextualQuestion = `Analyze ${company}: ${question}`;
    const streamUrl = `http://localhost:4000/analyze/stream?company=${encodeURIComponent(company)}&question=${encodeURIComponent(contextualQuestion)}`;
    const source = new EventSource(streamUrl);
    let receivedFinal = false;

    source.addEventListener("token", (evt) => {
      const payload = JSON.parse((evt as MessageEvent).data);
      setActiveNode(payload.node);
      setStreamingText((prev) => ({
        ...prev,
        [payload.node]: (prev[payload.node] || "") + payload.text
      }));
    });

    source.addEventListener("agent", (evt) => {
      const payload = JSON.parse((evt as MessageEvent).data);
      setEvents((prev) => [...prev, payload]);
      setActiveNode(payload.node);
      // Clear streaming text for this node since it's now complete
      setStreamingText((prev) => {
        const next = { ...prev };
        delete next[payload.node];
        return next;
      });
    });

    source.addEventListener("final", (evt) => {
      receivedFinal = true;
      const payload = JSON.parse((evt as MessageEvent).data);
      setFinalReport(payload);
      setRunning(false);
      setActiveNode("");
      source.close();
    });

    source.addEventListener("error", (evt) => {
      const payload = JSON.parse((evt as MessageEvent).data);
      setErrorMsg(payload.message || "An error occurred.");
      setRunning(false);
      setActiveNode("");
      source.close();
    });

    source.onerror = () => {
      if (!receivedFinal) {
        setRunning(false);
        setActiveNode("");
        if (!errorMsg) setErrorMsg("Connection lost. Please restart the API server.");
      }
      source.close();
    };
  }, [canRun, running, company, question, errorMsg]);

  const resetAll = () => {
    setFinalReport("");
    setEvents([]);
    setElapsed(0);
    setStreamingText({});
    setErrorMsg("");
    setActiveNode("");
  };

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(finalReport);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  const handleFeatureClick = (name: string) => {
    alert(`${name} feature is coming soon in the next update!`);
  };

  const completedAgents = completedNodes.size;

  return (
    <div className="relative h-screen flex flex-col text-white overflow-hidden">
      <div className="ambient-bg" />
      <div className="glow-overlay" />
      
      <div className="particles">
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className={`particle particle-${i + 1}`} />
        ))}
      </div>
      
      {/* Top Navigation */}
      <header className="dashboard-header flex-none">
        <div className="flex items-center gap-3">
          <motion.div whileHover={{ scale: 1.05, rotate: 5 }} className="logo-container">
            <Layers className="logo-icon" size={20} />
          </motion.div>
          <span className="logo-text">NexusFlow <span className="logo-accent">Research</span></span>
        </div>
        
        <div className="nav-links">
          <span className="nav-link" onClick={() => setCurrentView("dashboard")}>Search Tool</span>
          <span className="nav-link" onClick={() => { setCurrentView("ledger"); loadReports(); }}>Research Ledger</span>
          <span className="nav-link" onClick={() => setCurrentView("dashboard")}>Data Analysis</span>
          <div className="user-profile flex items-center gap-3">
            <Settings size={18} className="nav-link" onClick={() => handleFeatureClick("Settings")} />
            <SignedIn>
              <UserButton appearance={{ elements: { userButtonAvatarBox: "w-8 h-8 rounded-full border border-white/20" } }} />
            </SignedIn>
            <SignedOut>
              <SignInButton mode="modal">
                <button 
                  className="btn-signin"
                  aria-label="Sign in to your account"
                >
                  <User size={16} className="signin-icon text-white" />
                  <span>Sign In</span>
                  <ArrowRight size={14} className="signin-icon signin-icon-arrow opacity-50" />
                </button>
              </SignInButton>
            </SignedOut>
          </div>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden p-6 gap-6 z-10">
        {/* Left Sidebar */}
        <nav className="glass-panel sidebar-nav flex-none">
          <NavItem icon={<Activity size={24} />} title="Dashboard" active={currentView === "dashboard"} onClick={() => setCurrentView("dashboard")} />
          <NavItem icon={<FileText size={24} />} title="Research Ledger" active={currentView === "ledger"} onClick={() => { setCurrentView("ledger"); loadReports(); }} />
          <NavItem icon={<Globe size={24} />} title="Web Search" active={currentView === "search"} onClick={() => setCurrentView("search")} />
          <NavItem icon={<Terminal size={24} />} title="Terminal" active={currentView === "terminal"} onClick={() => setCurrentView("terminal")} />
          <div className="mt-auto">
            <SignedIn>
              <NavItem icon={<LogOut size={24} />} title="Logout" onClick={() => signOut()} />
            </SignedIn>
          </div>
        </nav>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col gap-6 overflow-hidden">
          {currentView === "ledger" && (
            <div className="flex-1 glass-panel relative overflow-hidden flex flex-col">
              <div className="p-6 border-b border-white-08">
                <h1 className="research-report-title">Research <span className="accent-text">Ledger</span></h1>
                <p className="nav-link-muted">Browse and manage historical intelligence reports.</p>
              </div>
              <div className="flex-1 p-6 overflow-y-auto custom-scrollbar">
                {loadingReports ? (
                  <div className="flex justify-center items-center h-full">
                    <Loader2 size={32} className="animate-spin text-white-30" />
                  </div>
                ) : reportsList.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full opacity-50">
                    <FileText size={48} className="mb-4" />
                    <p>No historical reports found.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {reportsList.map((report) => (
                      <div key={report.id} className="ledger-card">
                        <div className="flex justify-between items-start mb-2">
                          <h3 className="font-bold text-lg">{report.company}</h3>
                          <span className="text-xs opacity-50">{new Date(report.createdAt).toLocaleDateString()}</span>
                        </div>
                        <p className="text-sm opacity-70 mb-4 line-clamp-2">{report.question}</p>
                        <div className="flex items-center justify-between mt-auto pt-4 border-t border-white-08">
                          <div className="flex gap-3 text-xs opacity-60">
                            <span><FileText size={12} className="inline mr-1" /> {report.documentCount} sources</span>
                          </div>
                          <div className="flex gap-2">
                            <button 
                              className="ledger-btn ledger-btn-danger" 
                              onClick={() => deleteReport(report.id)}
                              title="Delete report"
                              aria-label="Delete report"
                            >
                              <Trash2 size={14} />
                            </button>
                            <button className="ledger-btn ledger-btn-primary" onClick={() => loadPastReport(report.id)}>
                              View <ArrowRight size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          {currentView === "dashboard" && (
            <>
              {/* Agent Pipeline Tracker */}
          {(running || events.length > 0) && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-panel p-4 flex-none"
            >
              <div className="pipeline-tracker">
                {PIPELINE_STAGES.map((stage, i) => {
                  const meta = AGENT_META[stage];
                  const isCompleted = completedNodes.has(stage);
                  const isActive = activeNode === stage;
                  return (
                    <div key={stage} className="pipeline-stage-wrapper">
                      <motion.div
                        animate={isActive ? { scale: [1, 1.1, 1] } : {}}
                        transition={{ duration: 1.5, repeat: Infinity }}
                        className={cn(
                          "pipeline-stage",
                          isCompleted && "pipeline-completed",
                          isActive && "pipeline-active",
                          !isCompleted && !isActive && "pipeline-pending"
                        )}
                      >
                        {isCompleted ? (
                          <CheckCircle2 size={14} />
                        ) : isActive ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Circle size={14} />
                        )}
                        <span>{meta?.label || stage}</span>
                      </motion.div>
                      {i < PIPELINE_STAGES.length - 1 && (
                        <div className={cn("pipeline-connector", isCompleted && "pipeline-connector-active")} />
                      )}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}

          {/* Main Research View */}
          <div className="flex-1 glass-panel">
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
              <div className="p-8 pb-32">
                <AnimatePresence mode="wait">
                {errorMsg ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="h-full flex flex-col items-center justify-center text-center gap-4"
                  >
                    <div className="empty-state-icon border-bear">
                      <span className="text-[2.5rem]">⚠️</span>
                    </div>
                    <h2 className="research-report-title text-bear">Analysis Error</h2>
                    <p className="nav-link-muted">{errorMsg}</p>
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={resetAll}
                      className="btn-action"
                    >
                      <RotateCcw size={16} /> Try Again
                    </motion.button>
                  </motion.div>
                ) : finalReport ? (
                  <motion.div 
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ type: "spring", damping: 20 }}
                    className="w-full"
                  >
                    {/* Report Header Bar */}
                    <div className="report-header-bar">
                      <h1 className="research-report-title">Intelligence Report: <span className="accent-text">{company}</span></h1>
                      <div className="report-actions">
                        <div className="report-meta-badge">
                          <Clock size={14} /> {elapsed}s
                        </div>
                        <div className="report-meta-badge">
                          <Brain size={14} /> {completedAgents} agents
                        </div>
                        <motion.button
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={copyReport}
                          className="btn-action"
                        >
                          <Copy size={14} /> {copied ? "Copied!" : "Copy"}
                        </motion.button>
                        <motion.button
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={resetAll}
                          className="btn-action"
                        >
                          <RotateCcw size={14} /> New Research
                        </motion.button>
                      </div>
                    </div>
                    <div className="report-content">
                      <ReactMarkdown
                        components={{
                          h1: ({ children }) => <h1>{children}</h1>,
                          h2: ({ children }) => <h2>{children}</h2>,
                          h3: ({ children }) => <h3>{children}</h3>,
                          strong: ({ children }) => <strong>{children}</strong>,
                          em: ({ children }) => <em>{children}</em>,
                          blockquote: ({ children }) => <blockquote>{children}</blockquote>,
                          code: ({ className, children, ...props }) => {
                            const isInline = !className;
                            return isInline
                              ? <code {...props}>{children}</code>
                              : <pre><code className={className} {...props}>{children}</code></pre>;
                          },
                          table: ({ children }) => <table>{children}</table>,
                          thead: ({ children }) => <thead>{children}</thead>,
                          tbody: ({ children }) => <tbody>{children}</tbody>,
                          tr: ({ children }) => <tr>{children}</tr>,
                          th: ({ children }) => <th>{children}</th>,
                          td: ({ children }) => <td>{children}</td>,
                          a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
                          hr: () => <hr />,
                        }}
                      >
                        {finalReport}
                      </ReactMarkdown>

                      {/* Render Data Analyst Chart if exists */}
                      {(() => {
                        const dataEvent = events.find(e => e.node === "data_analyst");
                        if (dataEvent && dataEvent.update?.dataAnalysisChart) {
                          return (
                            <div className="data-analyst-container">
                              <h2 className="data-analyst-title">
                                <span className="data-analyst-title-icon">📊</span> Quantitative Analysis
                              </h2>
                              <div className="data-analyst-chart-wrapper">
                                <img 
                                  src={dataEvent.update.dataAnalysisChart} 
                                  alt="Data Analyst Visualization" 
                                  className="data-analyst-chart-img"
                                />
                              </div>
                            </div>
                          );
                        }
                        return null;
                      })()}

                    </div>
                  </motion.div>
                ) : (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="h-full flex flex-col items-center justify-center text-center"
                  >
                    {running ? (
                      <div className="loading-container">
                        <div className="spinner-outer">
                          <motion.div 
                             animate={{ rotate: 360 }}
                             transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                             className="spinner-ring"
                          />
                          <div className="spinner-icon">
                            <Brain size={42} />
                          </div>
                        </div>
                        <h2 className="loading-title">Analyzing <span className="accent-text">{company}</span>...</h2>
                        <p className="nav-link-muted">
                          {activeNode === "generate_queries" && "Generating research queries..."}
                          {activeNode === "retrieve_documents" && "Scanning local & web intelligence..."}
                          {activeNode === "bull_analyst" && "🟢 Bull Analyst building upside case..."}
                          {activeNode === "bear_analyst" && "🔴 Bear Analyst identifying risks..."}
                          {activeNode === "data_analyst" && "📊 Data Analyst executing quantitative python models..."}
                          {activeNode === "critic" && "🔍 Critic scoring analysis quality..."}
                          {activeNode === "synthesize" && "⚡ Executive synthesizing final verdict..."}
                          {!activeNode && "NexusFlow agents are processing..."}
                        </p>
                        <div className="timer-badge">
                          <Clock size={14} /> {elapsed}s elapsed
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-6">
                        <motion.div 
                          animate={{ y: [0, -10, 0] }}
                          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                          className="empty-state-icon"
                        >
                          <Search size={40} />
                        </motion.div>
                        <div>
                          <h2 className="research-report-title">Ready for Intelligence</h2>
                          <p className="nav-link-muted max-w-md mx-auto">Enter a company name and research question below to initiate autonomous multi-agent analysis.</p>
                        </div>
                        <div className="hero-badges">
                          <span className="hero-badge badge-bull">🟢 Bull Analyst</span>
                          <span className="hero-badge badge-bear">🔴 Bear Analyst</span>
                          <span className="hero-badge badge-critic">🔍 Quality Critic</span>
                          <span className="hero-badge badge-data">📊 Data Analyst</span>
                          <span className="hero-badge badge-executive">⚡ Executive Synthesis</span>
                        </div>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
              </div>
            </div>
          </div>

          {/* Bottom Input Area */}
          <div className="glass-panel p-4 flex-none">
             <div className="flex items-center gap-4 w-full">
               <div className="flex-none w-48">
                 <input 
                   className="input-glass"
                   value={company}
                   onChange={(e) => setCompany(e.target.value)}
                   placeholder="Company / Ticker"
                   id="company-input"
                 />
               </div>
               <div className="flex-1 relative">
                  <input 
                    className="input-glass input-with-button"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="Ask a research question..."
                    onKeyDown={(e) => e.key === "Enter" && run()}
                    id="question-input"
                  />
                  <SignedIn>
                    <button 
                      onClick={run}
                      disabled={!canRun || running}
                      title="Run analysis"
                      aria-label="Run analysis"
                      className="btn-send"
                      id="run-button"
                    >
                      {running ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                    </button>
                  </SignedIn>
                  <SignedOut>
                    <SignInButton mode="modal">
                      <button 
                        title="Sign in to run analysis"
                        aria-label="Sign in"
                        className="btn-send"
                        id="run-button-signed-out"
                        onClick={(e) => e.preventDefault()}
                      >
                        <User size={18} />
                      </button>
                    </SignInButton>
                  </SignedOut>
               </div>
             </div>
          </div>
            </>
          )}

          {currentView === "terminal" && (
            <div className="flex-1 glass-panel relative overflow-hidden flex flex-col p-6">
              <h1 className="research-report-title mb-6">Cloud <span className="accent-text">Terminal</span></h1>
              <div className="terminal-window flex-1">
                <div className="terminal-header">
                  <Terminal size={14} /> nexus@cloud-sandbox:~$
                </div>
                <div className="terminal-body custom-scrollbar" ref={terminalScrollRef}>
                  <div className="terminal-log">
                    <span className="terminal-log-stdout">Welcome to NexusFlow Interactive Terminal. Type Python or Bash commands to execute in the E2B Sandbox.</span>
                  </div>
                  {terminalLogs.map((log, i) => (
                    <div key={i} className="terminal-log">
                      {log.type === 'cmd' && <span className="terminal-log-command"><span className="terminal-prompt">$</span> {log.content}</span>}
                      {log.type === 'stdout' && <span className="terminal-log-stdout">{log.content}</span>}
                      {log.type === 'stderr' && <span className="terminal-log-stderr">{log.content}</span>}
                      {log.type === 'chart' && <img src={log.content} alt="Output Chart" className="mt-2 rounded terminal-chart" />}
                    </div>
                  ))}
                  <div className="terminal-input-container">
                    <span className="terminal-prompt">$</span>
                    <input 
                      type="text" 
                      className="terminal-input-field" 
                      value={terminalInput}
                      onChange={(e) => setTerminalInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && runTerminalCommand()}
                      placeholder="Enter command..."
                      disabled={terminalRunning}
                      autoFocus
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {currentView === "search" && (
            <div className="flex-1 glass-panel relative overflow-y-auto custom-scrollbar flex flex-col p-6">
              <h1 className="research-report-title mb-6">Intelligence <span className="accent-text">Web Search</span></h1>
              <div className="websearch-window">
                <div className="websearch-input-wrapper">
                  <input 
                    className="input-glass flex-1"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Enter a specific question for instant intel..."
                    onKeyDown={(e) => e.key === "Enter" && runWebSearch()}
                  />
                  <button 
                    className="websearch-btn"
                    onClick={runWebSearch}
                    disabled={searchRunning || !searchQuery.trim()}
                  >
                    {searchRunning ? <Loader2 size={18} className="animate-spin mx-auto" /> : "Search Intel"}
                  </button>
                </div>
                <div className="websearch-results">
                  {searchRunning ? (
                    <div className="flex flex-col items-center justify-center opacity-50 h-full">
                      <Loader2 size={32} className="animate-spin mb-4 text-white-30" />
                      <p>Consulting sources...</p>
                    </div>
                  ) : searchResult ? (
                    <div className="report-content">
                      <ReactMarkdown>{searchResult}</ReactMarkdown>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center opacity-50 h-full">
                      <Globe size={48} className="mb-4" />
                      <p>Run a targeted web search.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Sidebar */}
        <div className="w-80 flex-none flex flex-col gap-6 min-h-0">
          <div className="flex-1 glass-panel flex flex-col min-h-0">
            <div className="thoughts-container-header p-5 flex-none">
              <h3 className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Zap size={18} className="accent-text" />
                  Agent Thoughts
                </span>
                {running ? <span className="badge-live">Live</span> : <span className="badge-live badge-idle">Idle</span>}
              </h3>
            </div>
            <div 
              ref={scrollRef}
              className="flex-1 min-h-0 overflow-y-auto custom-scrollbar"
            >
              <div className="flex flex-col gap-4 p-5 pb-10">
                <AnimatePresence>
                  {events.map((e, i) => {
                    const meta = AGENT_META[e.node] || { label: e.node, icon: "🤖", colorClass: "", cardClass: "" };
                    const isActive = running && i === events.length - 1;
                    
                    return (
                      <motion.div 
                        key={i}
                        initial={{ opacity: 0, x: 20, scale: 0.95 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                        className={cn("thought-card", meta.cardClass, isActive && "thought-active")}
                      >
                        <div className="thought-header">
                          <span className={cn("thought-node-name", meta.colorClass)}>
                            {meta.icon} {meta.label}
                          </span>
                          <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <div className="thought-text">
                          {formatEventMessage(e)}
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
                {/* Live streaming text for currently active node */}
                {Object.entries(streamingText).map(([nodeName, text]) => {
                  const meta = AGENT_META[nodeName] || { label: nodeName, icon: "🤖", colorClass: "", cardClass: "" };
                  return (
                    <motion.div 
                      key={`stream-${nodeName}`}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={cn("thought-card thought-active", meta.cardClass)}
                    >
                      <div className="thought-header">
                        <span className={cn("thought-node-name", meta.colorClass)}>
                          {meta.icon} {meta.label}
                        </span>
                        <span className="streaming-badge">STREAMING</span>
                      </div>
                      <div className="thought-text">
                        {text.slice(-200)}
                        <span className="streaming-cursor">▌</span>
                      </div>
                    </motion.div>
                  );
                })}
                {events.length === 0 && !running && Object.keys(streamingText).length === 0 && (
                  <div className="thoughts-empty-state">
                    <p>Awaiting research initiation...</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Mini Stats Card */}
          <div className="glass-panel p-6 stats-card flex-none">
             <div className="flex items-center justify-between">
                <span className="stats-label">Model Intelligence</span>
                <span className="accent-text stats-model-name">Command R+</span>
             </div>
             <div className="progress-bar-container">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: running ? `${Math.min(completedAgents * 16, 80)}%` : finalReport ? "100%" : "0%" }}
                  transition={{ duration: 1.5, ease: "easeOut" }}
                  className="progress-bar-fill"
                />
             </div>
             <div className="stats-grid">
                <div className="stat-item">
                 <div className="stat-value">{completedAgents}<span className="stat-total">/7</span></div>
                  <div className="stat-caption">Agents</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{events.reduce((acc, e) => acc + (e.update?.documents?.length || 0), 0) || "—"}</div>
                  <div className="stat-caption">Sources</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{elapsed || "—"}<span className="stat-total">s</span></div>
                  <div className="stat-caption">Time</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{finalReport ? "✅" : running ? "⏳" : "—"}</div>
                  <div className="stat-caption">Status</div>
                </div>
             </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function NavItem({ icon, active = false, onClick, title }: { icon: React.ReactNode; active?: boolean; onClick?: () => void; title?: string }) {
  return (
    <motion.div 
      whileHover={{ x: 2 }}
      className={cn("nav-item", active && "active")}
      onClick={onClick}
      aria-label={title}
    >
      {icon}
    </motion.div>
  );
}

function formatEventMessage(event: AgentEvent) {
  const { node, update } = event;
  if (node === "generate_queries") {
    return `Expanding research into: ${update.queries?.join(", ") || "..."}`;
  }
  if (node === "retrieve_documents") {
    return `Collected ${update.documents?.length || 0} documents from local and web intelligence sources.`;
  }
  if (node === "bull_analyst") {
    const preview = update.bullAnalysis?.slice(0, 120) || "Building upside case...";
    return `${preview}...`;
  }
  if (node === "bear_analyst") {
    const preview = update.bearAnalysis?.slice(0, 120) || "Identifying risks and red flags...";
    return `${preview}...`;
  }
  if (node === "data_analyst") {
    const preview = update.dataAnalysisOutput?.slice(0, 120) || "Executing quantitative analysis in E2B sandbox...";
    return `${preview}...`;
  }
  if (node === "critic") {
    const preview = update.criticReview?.slice(0, 120) || "Scoring analysis quality...";
    return `${preview}...`;
  }
  if (node === "synthesize") {
    return "Weighing all arguments to deliver final executive verdict.";
  }
  return `Agent ${node} is processing...`;
}
