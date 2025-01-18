export default function Logo(props) {
  return (
    <svg {...props} width="1em" height="1em" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="shapeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style={{
                    stopColor: "#64748B",
                    stopOpacity: 0.7,
                }} />
                <stop offset="50%" style={{
                    stopColor: "#64748B",
                    stopOpacity: 0.7,
                }} />
                
                <stop offset="100%" style={{
                    stopColor: "#64748B",
                    stopOpacity: 0.2,
                }} />
            </linearGradient>
        </defs>
        
        {/* <!-- Background --> */}
        {/* <rect width="256" height="256" fill="#FFFFFF"/> */}
        
        {/* <!-- Floating Layers - Adjusted to 2/3 size --> */}
        <g opacity="0.9">
            <path d="M43 173L128 88L213 173" fill="url(#shapeGrad)" opacity="0.4" transform="rotate(0 128 128)"/>
            <path d="M43 148L128 63L213 148" fill="url(#shapeGrad)" opacity="0.5" transform="rotate(0 128 128)"/>
            <path d="M43 123L128 38L213 123" fill="url(#shapeGrad)" opacity="0.6" transform="rotate(0 128 128)"/>
        </g>
        
        {/* <!-- Enhanced Center Point --> */}
        <circle cx="128" cy="128" r="6" fill="#64748B" opacity="0.9"/>
    </svg>
    
  );
}