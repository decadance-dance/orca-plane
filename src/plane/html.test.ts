import { assert, test } from 'orca/testing'
import { htmlToText } from './html'

test('paragraphs and line breaks become newlines', () => {
  assert.equal(htmlToText('<p>one</p><p>two<br>three<br/>four</p>'), 'one\ntwo\nthree\nfour')
})

test('entities decode', () => {
  assert.equal(htmlToText('<p>a &lt;b&gt; &amp; &quot;c&quot; &#39;d&#39;&nbsp;e</p>'), 'a <b> & "c" \'d\' e')
})

test('nested markup keeps its text, blank runs collapse', () => {
  assert.equal(
    htmlToText('<ul><li><strong>bold <em>it</em></strong></li><li>x</li></ul><p></p><p></p><p>end</p>'),
    'bold it\nx\n\nend'
  )
})
