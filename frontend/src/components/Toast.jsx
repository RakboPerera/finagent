import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { Check, AlertTriangle, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'info', duration = 4000) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    if (duration > 0) setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
  }, []);

  const remove = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={addToast}>
      {children}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            {t.type === 'success' && <Check size={14} />}
            {t.type === 'error' && <AlertTriangle size={14} />}
            {t.type === 'info' && <Info size={14} />}
            {t.type === 'warning' && <AlertTriangle size={14} />}
            <span style={{ flex: 1 }}>{t.message}</span>
            <button className="toast-close" onClick={() => remove(t.id)}><X size={12} /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
