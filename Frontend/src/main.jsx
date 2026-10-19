import React from "react"
import ReactDOM from "react-dom/client"
import { ThemeProvider } from "next-themes"
import { Provider } from "react-redux"
import { BrowserRouter, useLocation } from "react-router-dom"

import App from "@/App"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { store } from "@/store"
import "@/index.css"

function ScrollToTop() {
  const { pathname } = useLocation()
  React.useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Provider store={store}>
      <BrowserRouter>
        <ScrollToTop />
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} themes={["light", "dark"]} storageKey="gfw-theme" disableTransitionOnChange>
          <TooltipProvider delayDuration={200}>
            <App />
            <Toaster position="top-center" richColors closeButton />
          </TooltipProvider>
        </ThemeProvider>
      </BrowserRouter>
    </Provider>
  </React.StrictMode>
)
