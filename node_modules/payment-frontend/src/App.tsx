import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { DemoPage } from './pages/DemoPage';
import { PaymentPage } from './pages/PaymentPage';
import { ConfirmationPage } from './pages/ConfirmationPage';
import './App.css';

function App() {
  return (
    <Router>
      <div className="app">
        <Routes>
          <Route path="/" element={<DemoPage />} />
          <Route path="/payment/:orderId" element={<PaymentPage />} />
          <Route path="/confirmation/:orderId" element={<ConfirmationPage />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
