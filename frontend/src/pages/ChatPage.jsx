import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, MessageSquare, Trash2, Sparkles } from 'lucide-react';
import { api, getLlmConfig } from '../api';
import ChatView from '../components/Chat/ChatView.jsx';

export default function ChatPage() {
  const { conversationId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const { apiKey } = getLlmConfig();

  // Get initial question from URL params (from dashboard drill)
  const initialQuestion = searchParams.get('q');

  useEffect(() => {
    api.get('/chat/conversations').then(r => setConversations(r.data));
  }, [refreshKey]);

  // Clear the q param after it's been consumed
  useEffect(() => {
    if (initialQuestion) {
      setSearchParams({}, { replace: true });
    }
  }, []);

  const newConv = () => navigate('/chat');
  const deleteConv = async (id, e) => {
    e.stopPropagation(); e.preventDefault();
    if (!confirm('Delete this conversation?')) return;
    await api.delete(`/chat/conversations/${id}`);
    setRefreshKey(k => k + 1);
    if (conversationId === id) navigate('/chat');
  };
  const clearMyConversations = async () => {
    const userConvs = conversations.filter(c => c.is_demo === 0);
    if (userConvs.length === 0) return;
    if (!confirm(`Clear ${userConvs.length} non-demo conversation(s)? The 6 demo conversations will not be affected.`)) return;
    await api.delete('/chat/conversations-non-demo/all');
    setRefreshKey(k => k + 1);
    if (conversationId && userConvs.some(c => c.id === conversationId)) navigate('/chat');
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Chat with your data</h1>
          <div className="page-subtitle">
            {apiKey
              ? 'Ask questions, get answers with confidence scores and audit trails.'
              : 'Browse the demo conversations below to see what FinAgent can do — add an API key in Settings to ask your own questions.'}
          </div>
        </div>
        <button className="btn btn-primary" onClick={newConv} disabled={!apiKey} title={!apiKey ? 'Add an API key in Settings first' : ''}>
          <Plus size={14} /> New conversation
        </button>
      </div>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div className="chat-sidebar">
          <div className="chat-sidebar-header">
            Recent conversations
          </div>
          {conversations.length === 0 && (
            <div style={{ padding: 16, fontSize: 12, color: 'var(--c-text-muted)' }}>
              No conversations yet. Ask a question to get started.
            </div>
          )}
          {conversations.some(c => c.is_demo === 1) && (
            <div className="chat-sidebar-subheader">Demo conversations</div>
          )}
          {conversations.filter(c => c.is_demo === 1).map(c => (
            <div
              key={c.id}
              onClick={() => navigate(`/chat/${c.id}`)}
              className={'chat-sidebar-item' + (c.id === conversationId ? ' active' : '')}
            >
              <Sparkles size={14} style={{ flexShrink: 0, color: 'var(--c-accent)' }} />
              <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.title || 'Untitled'}
              </div>
              <span className="demo-pill">DEMO</span>
            </div>
          ))}
          {conversations.some(c => c.is_demo === 0) && (
            <div className="chat-sidebar-subheader chat-sidebar-subheader-with-action">
              <span>Your conversations</span>
              <button
                onClick={clearMyConversations}
                title="Clear all non-demo conversations"
                className="chat-sidebar-clear-btn"
              >
                <Trash2 size={10} /> Clear all
              </button>
            </div>
          )}
          {conversations.filter(c => c.is_demo === 0).map(c => (
            <div
              key={c.id}
              onClick={() => navigate(`/chat/${c.id}`)}
              className={'chat-sidebar-item' + (c.id === conversationId ? ' active' : '')}
            >
              <MessageSquare size={14} style={{ flexShrink: 0, color: 'var(--c-text-muted)' }} />
              <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.title || 'Untitled'}
              </div>
              <button onClick={(e) => deleteConv(c.id, e)} title="Delete"
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--c-text-muted)', padding: 2 }}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <ChatView
            key={conversationId || 'new'}
            conversationId={conversationId}
            initialQuestion={initialQuestion}
            onConversationCreated={(id) => { setRefreshKey(k => k + 1); navigate(`/chat/${id}`); }}
          />
        </div>
      </div>
    </>
  );
}
