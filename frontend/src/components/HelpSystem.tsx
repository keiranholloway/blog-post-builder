import React, { useState, useEffect } from 'react';
import './HelpSystem.css';

interface HelpArticle {
  id: string;
  title: string;
  category: string;
  content: string;
  tags: string[];
  lastUpdated: string;
}

interface FAQItem {
  id: string;
  question: string;
  answer: string;
  category: string;
  helpful: number;
}

interface HelpSystemProps {
  isOpen: boolean;
  onClose: () => void;
}

const helpArticles: HelpArticle[] = [
  {
    id: 'getting-started',
    title: 'Getting Started with Voice Recording',
    category: 'Basics',
    content: `
# Getting Started with Voice Recording

## Quick Start
1. **Tap the voice recording button** - it's the large microphone icon on the main screen
2. **Speak for 1-3 minutes** about your blog post idea
3. **Wait for processing** - the AI will create your content
4. **Review and provide feedback** to refine the results

## Recording Tips
- **Find a quiet space** away from background noise
- **Hold your device 6-8 inches** from your mouth
- **Speak clearly and naturally** - don't rush
- **Organize your thoughts** briefly before recording

## What to Talk About
- Share your main idea or topic
- Mention your target audience
- Include key points you want to cover
- Add personal experiences or examples
    `,
    tags: ['voice', 'recording', 'basics', 'getting-started'],
    lastUpdated: '2024-01-15'
  },
  {
    id: 'platform-setup',
    title: 'Connecting Publishing Platforms',
    category: 'Publishing',
    content: `
# Connecting Publishing Platforms

## Supported Platforms
- **Medium**: Personal profile and publications
- **LinkedIn**: Professional posts and articles
- **More platforms coming soon**

## Connection Process
1. **Go to Settings** > Platform Connections
2. **Click "Connect"** next to your desired platform
3. **Authorize the app** through OAuth
4. **Verify the connection** shows as "Active"

## Troubleshooting Connections
- Ensure you're logged into the platform in the same browser
- Check that your account is in good standing
- Try incognito/private browsing if authorization fails
- Contact support if problems persist
    `,
    tags: ['platforms', 'publishing', 'medium', 'linkedin', 'oauth'],
    lastUpdated: '2024-01-14'
  },
  {
    id: 'content-review',
    title: 'Reviewing and Improving Generated Content',
    category: 'Content',
    content: `
# Reviewing and Improving Generated Content

## Review Process
1. **Read the generated blog post** carefully
2. **Check the AI-generated image** for relevance
3. **Use feedback forms** to request changes
4. **Review revisions** when notified
5. **Approve when satisfied** with the results

## Effective Feedback
- **Be specific**: "Make it more casual" vs "Change the tone"
- **Provide examples**: Reference your preferred writing style
- **Explain context**: Mention your audience and goals
- **Request specific changes**: "Add more technical details to section 2"

## Multiple Revisions
- You can request unlimited revisions
- Each revision improves based on your feedback
- The AI learns your preferences over time
    `,
    tags: ['review', 'feedback', 'content', 'revision', 'improvement'],
    lastUpdated: '2024-01-13'
  }
];

const faqItems: FAQItem[] = [
  {
    id: 'faq-1',
    question: 'Why isn\'t my voice recording working?',
    answer: 'Check that you\'ve granted microphone permissions to your browser. On mobile, ensure you\'re using a supported browser (Chrome, Safari, Firefox). The app requires HTTPS to access the microphone.',
    category: 'Technical',
    helpful: 45
  },
  {
    id: 'faq-2',
    question: 'How long should my voice recording be?',
    answer: 'Aim for 1-3 minutes. This gives the AI enough content to work with while keeping your ideas focused. Longer recordings may be cut off, shorter ones might not generate full blog posts.',
    category: 'Recording',
    helpful: 38
  },
  {
    id: 'faq-3',
    question: 'Can I edit the generated content before publishing?',
    answer: 'Yes! Use the feedback forms to request specific changes. You can also make direct edits in the review interface before approving for publication.',
    category: 'Content',
    helpful: 42
  },
  {
    id: 'faq-4',
    question: 'What happens to my voice recordings?',
    answer: 'Voice recordings are processed immediately and then deleted for privacy. Only the generated text content is stored, which you can delete anytime from your dashboard.',
    category: 'Privacy',
    helpful: 51
  },
  {
    id: 'faq-5',
    question: 'Why did publishing fail on one platform?',
    answer: 'Check your platform connection status in settings. Common causes include expired authentication, content policy violations, or platform outages. Try reconnecting the platform or contact support.',
    category: 'Publishing',
    helpful: 29
  }
];

const HelpSystem: React.FC<HelpSystemProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'search' | 'articles' | 'faq' | 'contact'>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedArticle, setSelectedArticle] = useState<HelpArticle | null>(null);
  const [expandedFAQ, setExpandedFAQ] = useState<string | null>(null);

  const categories = ['all', ...Array.from(new Set(helpArticles.map(article => article.category)))];
  const faqCategories = ['all', ...Array.from(new Set(faqItems.map(item => item.category)))];

  // Filter articles based on search and category
  const filteredArticles = helpArticles.filter(article => {
    const matchesSearch = searchQuery === '' || 
      article.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      article.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      article.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));
    
    const matchesCategory = selectedCategory === 'all' || article.category === selectedCategory;
    
    return matchesSearch && matchesCategory;
  });

  // Filter FAQ items
  const filteredFAQ = faqItems.filter(item => {
    const matchesSearch = searchQuery === '' ||
      item.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.answer.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesCategory = selectedCategory === 'all' || item.category === selectedCategory;
    
    return matchesSearch && matchesCategory;
  });

  // Reset search when tab changes
  useEffect(() => {
    setSearchQuery('');
    setSelectedCategory('all');
    setSelectedArticle(null);
  }, [activeTab]);

  if (!isOpen) return null;

  const renderSearchTab = () => (
    <div className="help-search-tab">
      <div className="help-search-header">
        <h3>How can we help you?</h3>
        <div className="help-search-bar">
          <input
            type="text"
            placeholder="Search for help topics..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="help-search-input"
          />
          <button className="help-search-button">🔍</button>
        </div>
      </div>

      {searchQuery && (
        <div className="help-search-results">
          <h4>Search Results</h4>
          
          {filteredArticles.length > 0 && (
            <div className="help-search-section">
              <h5>Articles</h5>
              {filteredArticles.slice(0, 3).map(article => (
                <div 
                  key={article.id} 
                  className="help-search-result"
                  onClick={() => setSelectedArticle(article)}
                >
                  <h6>{article.title}</h6>
                  <p>{article.content.substring(0, 150)}...</p>
                  <span className="help-result-category">{article.category}</span>
                </div>
              ))}
            </div>
          )}

          {filteredFAQ.length > 0 && (
            <div className="help-search-section">
              <h5>Frequently Asked Questions</h5>
              {filteredFAQ.slice(0, 3).map(item => (
                <div 
                  key={item.id} 
                  className="help-search-result"
                  onClick={() => {
                    setActiveTab('faq');
                    setExpandedFAQ(item.id);
                  }}
                >
                  <h6>{item.question}</h6>
                  <p>{item.answer.substring(0, 150)}...</p>
                  <span className="help-result-category">{item.category}</span>
                </div>
              ))}
            </div>
          )}

          {filteredArticles.length === 0 && filteredFAQ.length === 0 && (
            <div className="help-no-results">
              <p>No results found for "{searchQuery}"</p>
              <p>Try different keywords or <button onClick={() => setActiveTab('contact')}>contact support</button></p>
            </div>
          )}
        </div>
      )}

      {!searchQuery && (
        <div className="help-quick-links">
          <h4>Popular Topics</h4>
          <div className="help-quick-grid">
            <button 
              className="help-quick-link"
              onClick={() => setSelectedArticle(helpArticles[0])}
            >
              <span className="help-quick-icon">🎤</span>
              <span>Voice Recording</span>
            </button>
            <button 
              className="help-quick-link"
              onClick={() => setSelectedArticle(helpArticles[1])}
            >
              <span className="help-quick-icon">🔗</span>
              <span>Platform Setup</span>
            </button>
            <button 
              className="help-quick-link"
              onClick={() => setSelectedArticle(helpArticles[2])}
            >
              <span className="help-quick-icon">✏️</span>
              <span>Content Review</span>
            </button>
            <button 
              className="help-quick-link"
              onClick={() => setActiveTab('faq')}
            >
              <span className="help-quick-icon">❓</span>
              <span>FAQ</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const renderArticlesTab = () => (
    <div className="help-articles-tab">
      {selectedArticle ? (
        <div className="help-article-view">
          <button 
            className="help-back-button"
            onClick={() => setSelectedArticle(null)}
          >
            ← Back to Articles
          </button>
          <article className="help-article-content">
            <header className="help-article-header">
              <h2>{selectedArticle.title}</h2>
              <div className="help-article-meta">
                <span className="help-article-category">{selectedArticle.category}</span>
                <span className="help-article-date">Updated {selectedArticle.lastUpdated}</span>
              </div>
            </header>
            <div 
              className="help-article-body"
              dangerouslySetInnerHTML={{ 
                __html: selectedArticle.content.replace(/\n/g, '<br>') 
              }}
            />
          </article>
        </div>
      ) : (
        <div className="help-articles-list">
          <div className="help-articles-header">
            <h3>Help Articles</h3>
            <select 
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="help-category-filter"
            >
              {categories.map(category => (
                <option key={category} value={category}>
                  {category === 'all' ? 'All Categories' : category}
                </option>
              ))}
            </select>
          </div>
          
          <div className="help-articles-grid">
            {filteredArticles.map(article => (
              <div 
                key={article.id}
                className="help-article-card"
                onClick={() => setSelectedArticle(article)}
              >
                <h4>{article.title}</h4>
                <p>{article.content.substring(0, 120)}...</p>
                <div className="help-article-card-footer">
                  <span className="help-article-category">{article.category}</span>
                  <span className="help-article-date">{article.lastUpdated}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const renderFAQTab = () => (
    <div className="help-faq-tab">
      <div className="help-faq-header">
        <h3>Frequently Asked Questions</h3>
        <select 
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="help-category-filter"
        >
          {faqCategories.map(category => (
            <option key={category} value={category}>
              {category === 'all' ? 'All Categories' : category}
            </option>
          ))}
        </select>
      </div>

      <div className="help-faq-list">
        {filteredFAQ.map(item => (
          <div key={item.id} className="help-faq-item">
            <button
              className={`help-faq-question ${expandedFAQ === item.id ? 'expanded' : ''}`}
              onClick={() => setExpandedFAQ(expandedFAQ === item.id ? null : item.id)}
            >
              <span>{item.question}</span>
              <span className="help-faq-toggle">{expandedFAQ === item.id ? '−' : '+'}</span>
            </button>
            {expandedFAQ === item.id && (
              <div className="help-faq-answer">
                <p>{item.answer}</p>
                <div className="help-faq-footer">
                  <span className="help-faq-category">{item.category}</span>
                  <div className="help-faq-helpful">
                    <span>Was this helpful?</span>
                    <button className="help-helpful-button">👍</button>
                    <button className="help-helpful-button">👎</button>
                    <span className="help-helpful-count">{item.helpful} found this helpful</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  const renderContactTab = () => (
    <div className="help-contact-tab">
      <h3>Contact Support</h3>
      
      <div className="help-contact-options">
        <div className="help-contact-option">
          <h4>📧 Email Support</h4>
          <p>Get help with technical issues, account questions, or feature requests.</p>
          <p><strong>Response time:</strong> Usually within 24 hours</p>
          <button className="help-contact-button">Send Email</button>
        </div>

        <div className="help-contact-option">
          <h4>💬 Community Forum</h4>
          <p>Connect with other users, share tips, and get community support.</p>
          <p><strong>Response time:</strong> Community-driven</p>
          <button className="help-contact-button">Visit Forum</button>
        </div>

        <div className="help-contact-option">
          <h4>📊 System Status</h4>
          <p>Check if there are any known issues or maintenance windows.</p>
          <p><strong>Updated:</strong> Real-time</p>
          <button className="help-contact-button">Check Status</button>
        </div>
      </div>

      <div className="help-contact-form">
        <h4>Quick Contact Form</h4>
        <form className="help-form">
          <div className="help-form-group">
            <label htmlFor="help-subject">Subject</label>
            <select id="help-subject" className="help-form-select">
              <option value="">Select a topic</option>
              <option value="technical">Technical Issue</option>
              <option value="account">Account Question</option>
              <option value="feature">Feature Request</option>
              <option value="billing">Billing Question</option>
              <option value="other">Other</option>
            </select>
          </div>
          
          <div className="help-form-group">
            <label htmlFor="help-message">Message</label>
            <textarea 
              id="help-message"
              className="help-form-textarea"
              placeholder="Describe your issue or question..."
              rows={4}
            />
          </div>
          
          <button type="submit" className="help-form-submit">Send Message</button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="help-system-overlay">
      <div className="help-system-modal">
        <div className="help-system-header">
          <h2>Help & Support</h2>
          <button className="help-system-close" onClick={onClose}>×</button>
        </div>

        <div className="help-system-tabs">
          <button 
            className={`help-tab ${activeTab === 'search' ? 'active' : ''}`}
            onClick={() => setActiveTab('search')}
          >
            🔍 Search
          </button>
          <button 
            className={`help-tab ${activeTab === 'articles' ? 'active' : ''}`}
            onClick={() => setActiveTab('articles')}
          >
            📚 Articles
          </button>
          <button 
            className={`help-tab ${activeTab === 'faq' ? 'active' : ''}`}
            onClick={() => setActiveTab('faq')}
          >
            ❓ FAQ
          </button>
          <button 
            className={`help-tab ${activeTab === 'contact' ? 'active' : ''}`}
            onClick={() => setActiveTab('contact')}
          >
            💬 Contact
          </button>
        </div>

        <div className="help-system-content">
          {activeTab === 'search' && renderSearchTab()}
          {activeTab === 'articles' && renderArticlesTab()}
          {activeTab === 'faq' && renderFAQTab()}
          {activeTab === 'contact' && renderContactTab()}
        </div>
      </div>
    </div>
  );
};

export default HelpSystem;